use std::path::PathBuf;

#[test]
fn native_header_matches_rust_exports() {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bindings = cbindgen::Builder::new()
        .with_src(directory.join("src/ffi.rs"))
        .with_language(cbindgen::Language::C)
        .with_include_guard("PODCST_AUDIO_H")
        .with_documentation(false)
        .with_cpp_compat(true)
        .generate()
        .unwrap();
    let mut generated = Vec::new();
    bindings.write(&mut generated);
    let generated = String::from_utf8(generated)
        .unwrap()
        .lines()
        .map(|line| {
            line.split(" //")
                .next()
                .unwrap()
                .split(" /*")
                .next()
                .unwrap()
                .trim_end()
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let path = directory.join("include/podcst_audio.h");
    if std::env::var_os("PODCST_UPDATE_HEADER").is_some() {
        std::fs::write(&path, &generated).unwrap();
    }
    assert_eq!(std::fs::read_to_string(path).unwrap(), generated);
}
