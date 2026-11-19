// "Iniciar con Windows": a value under the user's Run key.
//
// **The registry is the setting, not a copy of it.** Windows reads
// `HKCU\...\Run` at sign-in and nothing else, so the switch in Settings asks
// the registry whether the value is there instead of trusting a field in
// `settings.json` — a value removed by Task Manager's "Startup apps" page would
// otherwise leave the switch saying "on" for an app that no longer starts.
//
// The launch carries `--minimized`: Star Music comes up in the tray, not in the
// person's face at every sign-in.

/// The argument a launch at sign-in carries.
pub const MINIMIZED_ARG: &str = "--minimized";

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW,
    };
    use windows::core::{HSTRING, w};

    const RUN_KEY: windows::core::PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    const VALUE: windows::core::PCWSTR = w!("Star Music");
    /// The value the app wrote while it was called Starless.
    const LEGACY_VALUE: windows::core::PCWSTR = w!("Starless");

    /// Whether the Starless entry is still there.
    pub fn legacy_enabled() -> bool {
        // SAFETY: as in `enabled`.
        let result = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, LEGACY_VALUE, RRF_RT_REG_SZ, None, None, None)
        };
        result == ERROR_SUCCESS
    }

    pub fn remove_legacy() {
        // SAFETY: as in `set`.
        let _ = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, LEGACY_VALUE) };
    }

    pub fn enabled() -> bool {
        // SAFETY: static, NUL-terminated names; no buffer is passed, so the
        // call only reports whether the value exists.
        let result =
            unsafe { RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, VALUE, RRF_RT_REG_SZ, None, None, None) };
        result == ERROR_SUCCESS
    }

    pub fn set(on: bool) -> Result<(), String> {
        if !on {
            // SAFETY: as above. A value that is not there is already "off".
            let result = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, VALUE) };
            return if result == ERROR_SUCCESS || !enabled() {
                Ok(())
            } else {
                Err(format!("{result:?}"))
            };
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let command = format!("\"{}\" {}", exe.display(), super::MINIMIZED_ARG);
        let data = HSTRING::from(command);
        // REG_SZ wants the bytes of the string including its terminating NUL.
        let bytes = (data.len() + 1) * std::mem::size_of::<u16>();
        // SAFETY: `data` is a NUL-terminated wide string that outlives the call,
        // and `bytes` is exactly its size.
        let result = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                RUN_KEY,
                VALUE,
                REG_SZ.0,
                Some(data.as_ptr().cast()),
                bytes as u32,
            )
        };
        if result == ERROR_SUCCESS { Ok(()) } else { Err(format!("{result:?}")) }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn enabled() -> bool {
        false
    }

    pub fn legacy_enabled() -> bool {
        false
    }

    pub fn remove_legacy() {}

    pub fn set(_on: bool) -> Result<(), String> {
        Err("unsupported".into())
    }
}

/// Whether Star Music starts at sign-in.
pub fn enabled() -> bool {
    imp::enabled()
}

/// Turn it on or off, and answer with what is true afterwards.
///
/// **Never from a development build.** The value is the path of the running
/// executable, and in `bun run app` that is `target\debug\star-music.exe`: the
/// next sign-in would start a debug build out of a source tree. The switch
/// answers with the registry as it is, so in development it does not move.
pub fn set(on: bool) -> bool {
    if cfg!(debug_assertions) {
        log::warn!("inicio con Windows: no se toca en una build de desarrollo");
        return enabled();
    }
    if let Err(error) = imp::set(on) {
        log::warn!("inicio con Windows: no se pudo cambiar el registro: {error}");
    }
    enabled()
}

/// Move "start with Windows" from its Starless entry to the Star Music one.
///
/// **The old entry points at an executable that no longer exists.** The
/// rename moved the install folder, so the value Starless wrote would start
/// nothing at the next sign-in, and the switch in Settings — which reads the
/// new name — would say "off" for a person who turned it on. The new entry is
/// written with this executable's path, which is the one that exists now.
/// Not from a development build, for the same reason as [`set`].
pub fn migrate() {
    if cfg!(debug_assertions) || !imp::legacy_enabled() {
        return;
    }
    if imp::set(true).is_ok() {
        imp::remove_legacy();
    }
}

/// Whether this launch came from sign-in.
pub fn launched_minimized() -> bool {
    std::env::args().any(|arg| arg == MINIMIZED_ARG)
}
