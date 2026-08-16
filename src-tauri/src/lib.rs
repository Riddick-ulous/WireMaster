#[tauri::command]
fn save_project_json(filename: String, contents: String) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Save WireMaster project")
        .set_file_name(filename)
        .add_filter("WireMaster project", &["json"])
        .save_file();

    let Some(path) = selected else {
        return Ok(None);
    };

    std::fs::write(&path, contents)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_project_json])
        .run(tauri::generate_context!())
        .expect("error while running WireMaster");
}
