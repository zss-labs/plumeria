use std::collections::VecDeque;
use std::sync::OnceLock;

use rustc_hash::{FxHashMap, FxHashSet};

#[path = "../../compiler/src/engine/data.rs"]
#[allow(dead_code)]
mod data;

use data::DIRECT_LONGHANDS;

fn longhands(property: &str) -> &'static [&'static str] {
    static TABLE: OnceLock<FxHashMap<&'static str, &'static [&'static str]>> = OnceLock::new();
    TABLE
        .get_or_init(|| DIRECT_LONGHANDS.iter().copied().collect())
        .get(property)
        .copied()
        .unwrap_or(&[])
}

fn shorthands(property: &str) -> &'static [&'static str] {
    static TABLE: OnceLock<FxHashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    TABLE
        .get_or_init(|| {
            let mut table: FxHashMap<&'static str, Vec<&'static str>> = FxHashMap::default();
            for (shorthand, longhands) in DIRECT_LONGHANDS {
                for longhand in *longhands {
                    table.entry(*longhand).or_default().push(*shorthand);
                }
            }
            table
        })
        .get(property)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn depth(property: &str, seen: &mut FxHashSet<String>) -> usize {
    if !seen.insert(property.to_string()) {
        return 0;
    }
    shorthands(property)
        .iter()
        .map(|shorthand| depth(shorthand, seen) + 1)
        .max()
        .unwrap_or(0)
}

pub fn rank(property: &str, conditional: bool) -> usize {
    if property.starts_with("--") {
        return 0;
    }
    1 + usize::from(conditional) + depth(property, &mut FxHashSet::default())
}

fn coverage(property: &str) -> FxHashSet<&str> {
    let mut leaves = FxHashSet::default();
    let mut queue = VecDeque::from([property]);
    let mut seen = FxHashSet::default();
    while let Some(current) = queue.pop_front() {
        if !seen.insert(current) {
            continue;
        }
        let next = longhands(current);
        if next.is_empty() {
            leaves.insert(current);
        } else {
            queue.extend(next.iter().copied());
        }
    }
    leaves
}

pub fn overlaps(first: &str, second: &str) -> bool {
    let left = coverage(first);
    coverage(second).iter().any(|leaf| left.contains(leaf))
}

#[derive(Clone, Debug)]
pub struct Write {
    pub property: String,
    pub suffix: String,
    pub rank: usize,
    pub place: usize,
}

pub fn unrepresentable<'a>(left: &'a [Write], right: &'a [Write]) -> Option<(&'a Write, &'a Write)> {
    for mine in left {
        for theirs in right {
            if mine.suffix != theirs.suffix || mine.place == theirs.place {
                continue;
            }
            if !overlaps(&mine.property, &theirs.property) {
                continue;
            }
            let (earlier, later) = if mine.place < theirs.place { (mine, theirs) } else { (theirs, mine) };
            if earlier.rank > later.rank {
                return Some((earlier, later));
            }
        }
    }
    None
}
