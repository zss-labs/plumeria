mod cascade;
mod consumer;
mod css;
mod resolve;
mod stylesheet;
mod stylex;
#[path = "../../compiler/src/js/number.rs"]
#[allow(dead_code)]
mod number;
mod js {
    pub(crate) use super::number;
}
#[cfg(test)]
mod tests;

use std::fs;
use std::process::ExitCode;

use oxc_allocator::Allocator;
use oxc_ast::ast::{Expression, ObjectProperty, PropertyKey};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::SourceType;
use rustc_hash::{FxHashMap, FxHashSet};

use consumer::{mentions, scan, Hold, Sheet};
use resolve::{basename, Paths};
use stylesheet::{convert, Report};

const IGNORED: &[&str] = &["node_modules", "dist", "build", "out", ".next", ".git", "coverage"];
const SOURCES: &[&str] = &["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const DEFAULT_STYLE_PROP: &str = "sx";
const TEXTS:&[&str] = &["css", "scss", "sass", "less", "vue", "svelte", "astro", "mdx", "html"];

const USAGE: &str = "Usage:
  npx @plumeria/migrate from <source>

Sources:
  css-modules
  stylex

Options:
      --dry-run     report what would change without writing
      --style-prop  the styling prop (default: styleProp in the bundler config, else sx)
  -h, --help        show this help";

struct Options {
    stylex: bool,
    dry_run: bool,
    style_prop: String,
}

fn parse_args(args: &[String]) -> Result<Option<Options>, String> {
    let mut from = Vec::new();
    let mut dry_run = false;
    let mut style_prop = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-h" | "--help" => return Ok(None),
            "--dry-run" => dry_run = true,
            "--style-prop" => style_prop = Some(iter.next().cloned().ok_or("--style-prop needs a name")?),
            flag if flag.starts_with('-') => return Err(format!("Unknown option {flag}")),
            name => from.push(name),
        }
    }
    let stylex = match from.as_slice() {
        ["from", "css-modules"] => false,
        ["from", "stylex"] => true,
        ["from", other] => return Err(format!("Cannot migrate from {other}.")),
        _ => return Err("Write the source after from, as in `from css-modules`.".to_string()),
    };
    let style_prop = match style_prop {
        Some(name) => name,
        None => configured_style_prop()?.unwrap_or_else(|| DEFAULT_STYLE_PROP.to_string()),
    };
    Ok(Some(Options { stylex, dry_run, style_prop }))
}

struct StyleProps(Vec<String>);

impl<'a> Visit<'a> for StyleProps {
    fn visit_object_property(&mut self, property: &ObjectProperty<'a>) {
        let named = match &property.key {
            PropertyKey::StaticIdentifier(name) => name.name.as_str() == "styleProp",
            PropertyKey::StringLiteral(literal) => literal.value.as_str() == Some("styleProp"),
            _ => false,
        };
        if named && let Expression::StringLiteral(value) = property.value.get_inner_expression() {
            self.0.push(value.value.as_str().unwrap_or_default().to_string());
        }
        walk::walk_object_property(self, property);
    }
}

fn configured_style_prop() -> Result<Option<String>, String> {
    let Ok(read) = fs::read_dir(".") else { return Ok(None) };
    let mut configs: Vec<String> = read
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| {
            name.rsplit_once('.')
                .is_some_and(|(stem, ext)| stem.ends_with(".config") && SOURCES.contains(&ext))
        })
        .collect();
    configs.sort();
    let mut found: Vec<(String, String)> = Vec::new();
    for config in configs {
        let Ok(text) = fs::read_to_string(&config) else { continue };
        if !text.contains("styleProp") {
            continue;
        }
        let Ok(source_type) = SourceType::from_path(&config) else { continue };
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &text, source_type).parse();
        let mut props = StyleProps(Vec::new());
        props.visit_program(&parsed.program);
        found.extend(props.0.into_iter().map(|name| (config.clone(), name)));
    }
    let mut names: Vec<&str> = found.iter().map(|(_, name)| name.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    match names.as_slice() {
        [] => Ok(None),
        [name] => Ok(Some(name.to_string())),
        _ => Err(format!(
            "The configs name more than one styleProp ({}). Pass --style-prop.",
            found.iter().map(|(file, name)| format!("{file}: {name}")).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn walk(entry: &str, found: &mut Vec<String>) {
    let path = if entry.is_empty() { "." } else { entry };
    let Ok(metadata) = fs::metadata(path) else { return };
    if metadata.is_file() {
        found.push(entry.to_string());
        return;
    }
    let Ok(read) = fs::read_dir(path) else { return };
    let mut names: Vec<String> = read.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
    names.sort();
    for name in names {
        if IGNORED.contains(&name.as_str()) {
            continue;
        }
        walk(&resolve::join(entry, &name), found);
    }
}

fn extension(path: &str) -> &str {
    basename(path).rsplit_once('.').map_or("", |(_, ext)| ext)
}

fn is_file(path: &str) -> bool {
    std::path::Path::new(path).is_file()
}

fn apply(text: &str, edits: &[(u32, u32, String)]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut at = 0usize;
    for (start, end, replacement) in edits {
        out.push_str(&text[at..*start as usize]);
        out.push_str(replacement);
        at = *end as usize;
    }
    out.push_str(&text[at..]);
    out
}

fn target_of(sheet: &str) -> String {
    format!("{}.styles.ts", sheet.strip_suffix(".module.css").unwrap_or(sheet))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let options = match parse_args(&args) {
        Ok(Some(options)) => options,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("✖ {message}\n\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };
    if options.stylex { stylex::run(&options) } else { run(&options) }
}

fn run(options: &Options) -> ExitCode {
    let mut project = Vec::new();
    walk("", &mut project);
    let paths: Vec<String> = project.iter().filter(|p| p.ends_with(".module.css")).cloned().collect();
    if paths.is_empty() {
        println!("No *.module.css found.");
        return ExitCode::SUCCESS;
    }

    let mut sheets: Vec<Sheet> = Vec::new();
    for path in paths {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let mut converted = convert(&text);
        let target = target_of(&path);
        if fs::metadata(&target).is_ok() {
            converted.reports.push(Report {
                line: 0,
                column: 0,
                kind: "target-exists",
                source: String::new(),
                hint: format!("{} already exists and was not overwritten.", basename(&target)),
                blocking: true,
            });
        }
        sheets.push(Sheet { path, target, converted });
    }

    let sources: Vec<(String, String)> = project
        .iter()
        .filter(|p| SOURCES.contains(&extension(p)))
        .filter_map(|p| Some((p.clone(), fs::read_to_string(p).ok()?)))
        .collect();

    let tsconfig = Paths::load(|path| fs::read_to_string(path).ok());
    let mut holds: Vec<Hold> = Vec::new();
    for other in project.iter().filter(|p| TEXTS.contains(&extension(p))) {
        let Ok(text) = fs::read_to_string(other) else { continue };
        for (index, sheet) in sheets.iter().enumerate() {
            if *other != sheet.path && mentions(sheet, tsconfig.as_ref(), &text) {
                holds.push(Hold {
                    sheet: index,
                    kind: "referenced-elsewhere",
                    name: basename(&sheet.path).to_string(),
                    file: other.clone(),
                    line: 0,
                    column: 0,
                    blocking: true,
                });
            }
        }
    }

    let mut held:FxHashSet<usize> = holds.iter().map(|h| h.sheet).collect();
    held.extend((0..sheets.len()).filter(|&i| sheets[i].converted.blocked()));

    let mut notes: Vec<Hold> = Vec::new();
    let mut rewrites: Vec<(String, Vec<(u32, u32, String)>)>;
    let mut failures: Vec<String>;
    loop {
        let active: Vec<usize> = (0..sheets.len()).filter(|i| !held.contains(i)).collect();
        let view: Vec<Sheet> = active
            .iter()
            .map(|&i| Sheet { path: sheets[i].path.clone(), target: sheets[i].target.clone(), converted: sheets[i].converted.clone() })
            .collect();
        rewrites = Vec::new();
        failures = Vec::new();
        notes.clear();
        let mut fresh = false;
        for (file, text) in &sources {
            let outcome = scan(file, text, &view, tsconfig.as_ref(), &is_file, &options.style_prop);
            if let Some(failure) = outcome.failed {
                failures.push(failure);
            }
            for mut hold in outcome.holds {
                hold.sheet = active[hold.sheet];
                if !hold.blocking {
                    notes.push(hold);
                    continue;
                }
                if held.insert(hold.sheet) {
                    fresh = true;
                }
                holds.push(hold);
            }
            if !outcome.edits.is_empty() {
                rewrites.push((file.clone(), outcome.edits));
            }
        }
        if !fresh {
            break;
        }
    }

    let converting: Vec<usize> = (0..sheets.len()).filter(|i| !held.contains(i)).collect();
    for &index in &converting {
        println!("  {}  ->  {}", sheets[index].path, sheets[index].target);
    }

    if options.dry_run {
        println!(
            "\n{} stylesheet(s) would be converted, {} consumer(s) rewritten.\nRun without --dry-run to apply.",
            converting.len(),
            rewrites.len()
        );
    } else {
        for &index in &converting {
            let sheet = &sheets[index];
            if let Err(error) = fs::write(&sheet.target, &sheet.converted.code) {
                eprintln!("✖ {}: {error}", sheet.target);
                return ExitCode::FAILURE;
            }
        }
        for (file, edits) in &rewrites {
            let text = &sources.iter().find(|(path, _)| path == file).unwrap().1;
            if let Err(error) = fs::write(file, apply(text, edits)) {
                eprintln!("✖ {file}: {error}");
                return ExitCode::FAILURE;
            }
        }
        for &index in &converting {
            if let Err(error) = fs::remove_file(&sheets[index].path) {
                eprintln!("✖ {}: {error}", sheets[index].path);
                return ExitCode::FAILURE;
            }
        }
        println!("\n✔ converted {} stylesheet(s) and rewrote {} consumer(s).", converting.len(), rewrites.len());
    }

    let mut lines = Vec::new();
    let mut by_sheet: FxHashMap<usize, Vec<&Hold>> = FxHashMap::default();
    for hold in holds.iter().chain(&notes) {
        by_sheet.entry(hold.sheet).or_default().push(hold);
    }
    for (index, sheet) in sheets.iter().enumerate() {
        let reports: Vec<&Report> = sheet.converted.reports.iter().collect();
        let consumers = by_sheet.get(&index).cloned().unwrap_or_default();
        if reports.is_empty() && consumers.is_empty() {
            continue;
        }
        lines.push(sheet.path.clone());
        for report in reports {
            let source = if report.source.is_empty() { String::new() } else { format!("  {}", report.source) };
            lines.push(format!("  {}:{}  {}{source}", report.line, report.column, report.kind));
            lines.push(format!("        {}", report.hint));
        }
        for hold in consumers {
            lines.push(format!("  {}:{}:{}  {}  {}", hold.file, hold.line, hold.column, hold.kind, hold.name));
        }
    }
    for failure in &failures {
        lines.push(failure.clone());
    }

    let left = (0..sheets.len()).any(|i| held.contains(&i)) || !failures.is_empty();
    if lines.is_empty() {
        return ExitCode::SUCCESS;
    }
    println!("\n{}\n", if left { "Left in place — nothing was written for these stylesheets:" } else { "Notes:" });
    for line in lines {
        println!("{line}");
    }
    if left { ExitCode::FAILURE } else { ExitCode::SUCCESS }
}
