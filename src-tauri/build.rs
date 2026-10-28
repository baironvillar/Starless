use std::process::Command;

fn main() {
    tauri_build::build();

    // El commit de esta build, para que la app sepa si es la misma que la
    // release pública. Ver `BUILD_COMMIT` en `src/lib.rs`.
    embed_commit();
}

/// El commit con el que se compila esta build.
///
/// **Va dentro del binario, y ése es el punto.** La app tiene que poder decir
/// "la release pública soy yo" sin preguntarle a nadie: la respuesta hace falta
/// exactamente cuando la red no está, que es cuando un actualizador que
/// adivina termina ofreciendo instalar la build que la persona ya tiene.
///
/// **La variable del entorno gana, y git contesta lo demás.** En la CI el
/// commit es el del tag que se está publicando —que la CI ya sabe— y en una
/// máquina con un clon es el `HEAD`. Si no hay ninguno de los dos, la build
/// simplemente no sabe su commit: la comparación se queda sin hacer y la puerta
/// de vuelta a la línea pública sigue abierta, que es lo de siempre.
fn embed_commit() {
    // El `HEAD` y las referencias: un commit cambia la rama, no el `HEAD`, así
    // que mirar sólo uno deja la build con el commit anterior.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");
    println!("cargo:rerun-if-changed=../.git/packed-refs");
    // Y la variable del entorno: cargo no la mira solo, así que sin esto una
    // build se queda con el commit viejo aunque la variable haya cambiado.
    println!("cargo:rerun-if-env-changed=STARLESS_COMMIT");

    let commit = std::env::var("STARLESS_COMMIT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| is_commit_sha(value))
        .or_else(git_head);

    if let Some(sha) = commit {
        println!("cargo:rustc-env=STARLESS_COMMIT={sha}");
    }
}

/// El commit del clon, si hay un clon.
///
/// **Cuarenta hex, o nada.** Un `HEAD` que no es un commit —un clon roto, un
/// archivo vacío— no sirve: un valor a medias se compararía con cualquier
/// release y daría "son distintas" para siempre, que es el bucle volviendo por
/// la puerta de atrás.
fn git_head() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        // El script de build corre en el directorio del crate, que es un
        // subdirectorio del clon.
        .current_dir("..")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8(output.stdout).ok()?;
    let sha = sha.trim();
    is_commit_sha(sha).then(|| sha.to_string())
}

/// Si una cadena es un sha de commit.
fn is_commit_sha(value: &str) -> bool {
    value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit())
}
