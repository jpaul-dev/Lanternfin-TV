//! Direct native player transport. No hidden WebView or library Activity is retained.
use std::sync::OnceLock;
use jni::{JNIEnv, JavaVM, objects::{GlobalRef, JClass, JObject, JString, JValue}};
use serde_json::Value;
use tauri::{AppHandle, Manager};

struct Bridge { vm: JavaVM, class: GlobalRef }
static BRIDGE: OnceLock<Bridge> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn register(app: &AppHandle) { let _ = APP.set(app.clone()); }

// The class reference comes from Java, so Rust worker threads never depend on FindClass's loader.
#[no_mangle]
pub extern "system" fn Java_io_github_jpauldev_lanternfin_NativeCompanion_nativeInitialize(
    env: JNIEnv, class: JClass,
) {
    if let (Ok(vm), Ok(class)) = (env.get_java_vm(), env.new_global_ref(class)) {
        let _ = BRIDGE.set(Bridge { vm, class });
    }
}

#[no_mangle]
pub extern "system" fn Java_io_github_jpauldev_lanternfin_NativeCompanion_nativeReport(
    mut env: JNIEnv, _class: JClass, report: JString,
) {
    let Some(app) = APP.get() else { return };
    let Ok(raw) = env.get_string(&report) else { return };
    let raw: String = raw.into();
    if raw.len() > 32768 { return; }
    if let Ok(payload) = serde_json::from_str(&raw) {
        let _ = crate::receiver::report_playback(&app.state::<crate::receiver::ReceiverState>(), payload);
    }
}

pub fn dispatch(method: &str, payload: &Value) -> bool {
    let Some(bridge) = BRIDGE.get() else { return false };
    let Ok(mut env) = bridge.vm.attach_current_thread() else { return false };
    let Ok(json) = env.new_string(payload.to_string()) else { return false };
    let class: &JClass = bridge.class.as_obj().into();
    let json = JObject::from(json);
    let result = env.call_static_method(class, method, "(Ljava/lang/String;)Z", &[JValue::Object(&json)]);
    let _ = env.delete_local_ref(json);
    match result.and_then(|value| value.z()) {
        Ok(handled) => handled,
        Err(_) => {
            // Do not log payloads: stream URLs can contain account credentials.
            let _ = env.exception_clear();
            log::warn!("[companion] native dispatch unavailable");
            false
        }
    }
}
