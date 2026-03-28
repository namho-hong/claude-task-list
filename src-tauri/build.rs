use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const APP_ICON_CONTENTS_JSON: &str = r#"{
  "images" : [
    { "filename" : "icon_16x16.png", "idiom" : "mac", "scale" : "1x", "size" : "16x16" },
    { "filename" : "icon_16x16@2x.png", "idiom" : "mac", "scale" : "2x", "size" : "16x16" },
    { "filename" : "icon_32x32.png", "idiom" : "mac", "scale" : "1x", "size" : "32x32" },
    { "filename" : "icon_32x32@2x.png", "idiom" : "mac", "scale" : "2x", "size" : "32x32" },
    { "filename" : "icon_128x128.png", "idiom" : "mac", "scale" : "1x", "size" : "128x128" },
    { "filename" : "icon_128x128@2x.png", "idiom" : "mac", "scale" : "2x", "size" : "128x128" },
    { "filename" : "icon_256x256.png", "idiom" : "mac", "scale" : "1x", "size" : "256x256" },
    { "filename" : "icon_256x256@2x.png", "idiom" : "mac", "scale" : "2x", "size" : "256x256" },
    { "filename" : "icon_512x512.png", "idiom" : "mac", "scale" : "1x", "size" : "512x512" },
    { "filename" : "icon_512x512@2x.png", "idiom" : "mac", "scale" : "2x", "size" : "512x512" }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
"#;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/macos-app-icon.png");
    println!("cargo:rerun-if-changed=macos/Assets.xcassets");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_icon_assets()
            .unwrap_or_else(|err| panic!("failed to prepare macOS app icon assets: {err}"));
    }

    tauri_build::build()
}

fn build_macos_icon_assets() -> Result<(), Box<dyn Error>> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let gen_dir = manifest_dir.join("gen").join("macos");
    let compiled_dir = gen_dir.join("compiled");
    let source_xcassets_dir = manifest_dir.join("macos").join("Assets.xcassets");
    let generated_xcassets_dir = gen_dir.join("Assets.xcassets");

    fs::create_dir_all(&compiled_dir)?;
    let xcassets_dir = if source_xcassets_dir.exists() {
        source_xcassets_dir
    } else {
        generate_app_iconset(&manifest_dir, &generated_xcassets_dir)?;
        generated_xcassets_dir
    };

    let partial_info_plist = compiled_dir.join("asset-info.plist");
    run(
        Command::new("xcrun")
            .arg("actool")
            .arg("--compile")
            .arg(&compiled_dir)
            .arg(&xcassets_dir)
            .args([
                "--platform",
                "macosx",
                "--minimum-deployment-target",
                "10.13",
                "--app-icon",
                "AppIcon",
                "--output-partial-info-plist",
            ])
            .arg(&partial_info_plist),
        "compile macOS asset catalog",
    )?;

    let compiled_assets = compiled_dir.join("Assets.car");
    if !compiled_assets.exists() {
        return Err(format!("actool did not produce {}", compiled_assets.display()).into());
    }

    fs::copy(&compiled_assets, gen_dir.join("Assets.car"))?;
    Ok(())
}

fn generate_app_iconset(
    manifest_dir: &Path,
    xcassets_dir: &Path,
) -> Result<(), Box<dyn Error>> {
    let icons_dir = manifest_dir.join("icons");
    let source_icon = find_source_icon(&icons_dir)?;
    let app_iconset_dir = xcassets_dir.join("AppIcon.appiconset");

    fs::create_dir_all(&app_iconset_dir)?;
    fs::write(
        app_iconset_dir.join("Contents.json"),
        APP_ICON_CONTENTS_JSON.as_bytes(),
    )?;

    for (filename, size) in [
        ("icon_16x16.png", 16),
        ("icon_16x16@2x.png", 32),
        ("icon_32x32.png", 32),
        ("icon_32x32@2x.png", 64),
        ("icon_128x128.png", 128),
        ("icon_128x128@2x.png", 256),
        ("icon_256x256.png", 256),
        ("icon_256x256@2x.png", 512),
        ("icon_512x512.png", 512),
        ("icon_512x512@2x.png", 1024),
    ] {
        resize_png(
            &source_icon,
            &app_iconset_dir.join(filename),
            size,
            format!("app icon variant {filename}"),
        )?;
    }

    Ok(())
}

fn find_source_icon(icons_dir: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let macos_specific = icons_dir.join("macos-app-icon.png");
    if macos_specific.exists() {
        return Ok(macos_specific);
    }

    let shared_icon = icons_dir.join("icon.png");
    if shared_icon.exists() {
        return Ok(shared_icon);
    }

    Err(format!(
        "missing source icon; expected {} or {}",
        macos_specific.display(),
        shared_icon.display()
    )
    .into())
}

fn resize_png(
    source: &Path,
    output: &Path,
    size: u32,
    label: String,
) -> Result<(), Box<dyn Error>> {
    run(
        Command::new("sips")
            .arg("-s")
            .arg("format")
            .arg("png")
            .arg("-z")
            .arg(size.to_string())
            .arg(size.to_string())
            .arg(source)
            .arg("--out")
            .arg(output),
        &label,
    )
}

fn run(command: &mut Command, label: &str) -> Result<(), Box<dyn Error>> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "{label} failed with status {}.\nstdout:\n{}\nstderr:\n{}",
        output.status, stdout, stderr
    )
    .into())
}
