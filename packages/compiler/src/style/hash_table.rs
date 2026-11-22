use std::borrow::Cow;

use rustc_hash::{FxHashMap, FxHashSet};

use crate::js::value::entries_object;
use crate::js::{Object, Value};
use crate::project::tables::{Map, PropsTable};
use crate::style::records::{HashTable, style_records};

const MIN_LENGTH: usize = 5;

pub struct StyleSource<'a> {
    pub names: Cow<'a, [String]>,
    pub files: Vec<&'a str>,
}

fn style_names(style: &Object) -> Vec<String> {
    style_records(style, None, None)
        .iter()
        .flat_map(|record| record.hash.split(' ').map(str::to_string))
        .collect()
}

pub fn refresh_name_cache(create_obj: &Map<Value>, cache: &mut Map<Vec<String>>) {
    cache.retain(|object_hash, _| create_obj.contains_key(object_hash));
    for (object_hash, obj) in create_obj {
        if cache.contains_key(object_hash) {
            continue;
        }
        let Value::Obj(obj) = obj else { continue };
        let names = obj
            .iter()
            .flat_map(|(_, style)| style_names(&entries_object(style)))
            .collect();
        cache.insert(object_hash.clone(), names);
    }
}

pub fn create_sources<'a>(
    cache: &'a Map<Vec<String>>,
    owners: impl Fn(&str) -> Vec<&'a str>,
) -> Vec<StyleSource<'a>> {
    cache
        .iter()
        .map(|(object_hash, names)| StyleSource {
            names: Cow::Borrowed(names.as_slice()),
            files: owners(object_hash),
        })
        .collect()
}

pub fn props_sources(props: &PropsTable) -> Vec<StyleSource<'_>> {
    props
        .values()
        .flat_map(|by_prop| by_prop.values().flatten())
        .map(|entry| StyleSource {
            names: Cow::Owned(style_names(&entry.style)),
            files: vec![entry.file.as_str()],
        })
        .collect()
}

pub fn element_sources(element_styles: &Map<Vec<Object>>) -> Vec<StyleSource<'_>> {
    element_styles
        .iter()
        .flat_map(|(file, styles)| {
            styles.iter().map(move |style| StyleSource {
                names: Cow::Owned(style_names(style)),
                files: vec![file.as_str()],
            })
        })
        .collect()
}

pub fn files_using(sources: &[StyleSource<'_>], hashes: &FxHashSet<&str>) -> Vec<String> {
    let mut files: FxHashSet<&str> = FxHashSet::default();
    for source in sources {
        if source
            .names
            .iter()
            .any(|name| hashes.contains(name.as_str()))
        {
            files.extend(source.files.iter().copied());
        }
    }
    files.into_iter().map(str::to_string).collect()
}

pub fn build_hash_table(sources: &[StyleSource<'_>]) -> HashTable {
    let hashes: FxHashSet<&str> = sources
        .iter()
        .flat_map(|source| source.names.iter().map(String::as_str))
        .collect();

    let mut table = HashTable::default();
    let max_length = hashes.iter().map(|hash| hash.len() - 1).max().unwrap_or(0);
    let mut pending: Vec<&str> = hashes.iter().copied().collect();
    let mut length = MIN_LENGTH;
    while length < max_length && !pending.is_empty() {
        let mut counts: FxHashMap<&str, usize> = FxHashMap::default();
        for hash in &hashes {
            if hash.len() - 1 < length {
                continue;
            }
            *counts.entry(&hash[hash.len() - length..]).or_default() += 1;
        }
        pending.retain(|hash| {
            if hash.len() - 1 <= length {
                return true;
            }
            let suffix = &hash[hash.len() - length..];
            if counts.get(suffix) != Some(&1) {
                return true;
            }
            table.insert((*hash).to_string(), format!("x{suffix}"));
            false
        });
        length += 1;
    }
    for hash in pending {
        table.insert(hash.to_string(), hash.to_string());
    }
    table
}

const FULL_LENGTH: usize = 14;
const FALLBACK_LENGTH: usize = 7;

fn is_full_hash(name: &str) -> bool {
    name.len() == FULL_LENGTH
        && name.starts_with('x')
        && name[1..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte.is_ascii_lowercase())
}

pub fn short_name(name: &str, table: &HashTable) -> String {
    if let Some(short) = table.get(name) {
        return short.clone();
    }
    if is_full_hash(name) {
        return format!("x{}", &name[FULL_LENGTH - FALLBACK_LENGTH..]);
    }
    name.to_string()
}

pub fn shorten_atomic(atomic: &Value, table: &HashTable) -> Value {
    let Value::Obj(atomic) = atomic else {
        return atomic.clone();
    };
    let mut result = Object::new();
    for (key, value) in atomic.iter() {
        let value = match value {
            Value::Obj(atom_map) => Value::obj(shorten_atom_map(atom_map, table)),
            other => other.clone(),
        };
        result.insert(key, value);
    }
    Value::obj(result)
}

pub fn shorten_atom_map(atom_map: &Object, table: &HashTable) -> Object {
    let mut result = Object::new();
    for (key, value) in atom_map.iter() {
        let class_names = value
            .to_js_string()
            .split(' ')
            .map(|name| short_name(name, table))
            .collect::<Vec<_>>()
            .join(" ");
        result.insert(key, Value::Str(class_names));
    }
    result
}
