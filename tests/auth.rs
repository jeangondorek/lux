mod common;
use common::{send_and_read, LuxServer};
use std::io::Write;

// Raw-KV access to the internal `_t:` namespace (where auth rows live --
// password hashes, the JWT signing key, OAuth secrets) is reserved, for reads
// as well as writes, and on the batched pipeline path as well as the generic
// dispatch. Regression coverage for that guard, which was previously untested
// on the read/pipeline path. A bypass would return row data / empty arrays
// instead of the reserved-namespace error.
#[test]
fn pipelined_raw_kv_read_of_auth_keys_is_blocked() {
    let server = LuxServer::start();
    let mut conn = server.conn();

    let mut batch = common::resp_cmd(&["HGETALL", "_t:auth.users:row:x"]);
    batch.extend_from_slice(&common::resp_cmd(&[
        "HGET",
        "_t:auth.signing_keys:row:1",
        "private_key_encrypted",
    ]));
    conn.write_all(&batch).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(100));
    let resp = common::read_all(&mut conn);

    let blocked = resp.matches("reserved internal namespace").count();
    assert!(
        blocked >= 2,
        "both pipelined auth-key reads must be blocked, got: {resp:?}"
    );
}

// Same protection on a single (non-pipelined) read.
#[test]
fn raw_kv_read_of_auth_key_is_blocked() {
    let server = LuxServer::start();
    let mut conn = server.conn();
    let resp = send_and_read(&mut conn, &["HGETALL", "_t:auth.users:row:x"]);
    assert!(
        resp.contains("reserved internal namespace"),
        "auth-key read must be refused, got: {resp:?}"
    );
}

#[test]
fn commands_rejected_without_auth() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["SET", "k", "v"]);
    assert!(resp.contains("NOAUTH"), "should reject: {resp}");

    let resp = send_and_read(&mut conn, &["GET", "k"]);
    assert!(resp.contains("NOAUTH"), "still rejected: {resp}");
}

#[test]
fn ping_allowed_without_auth() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["PING"]);
    assert!(resp.contains("PONG"), "PING allowed: {resp}");
}

#[test]
fn auth_wrong_password_rejected() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["AUTH", "wrongpass"]);
    assert!(resp.contains("WRONGPASS"), "bad password: {resp}");

    let resp = send_and_read(&mut conn, &["SET", "k", "v"]);
    assert!(resp.contains("NOAUTH"), "still locked out: {resp}");
}

#[test]
fn auth_correct_password_allows_commands() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["AUTH", "secret123"]);
    assert!(resp.contains("+OK"), "auth success: {resp}");

    let resp = send_and_read(&mut conn, &["SET", "k", "v"]);
    assert!(resp.contains("+OK"), "command works after auth: {resp}");

    let resp = send_and_read(&mut conn, &["GET", "k"]);
    assert!(resp.contains("v"), "value readable: {resp}");
}

#[test]
fn auth_is_per_connection() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn1 = server.conn();
    let mut conn2 = server.conn();

    send_and_read(&mut conn1, &["AUTH", "secret123"]);
    send_and_read(&mut conn1, &["SET", "k", "fromconn1"]);

    let resp = send_and_read(&mut conn2, &["GET", "k"]);
    assert!(resp.contains("NOAUTH"), "conn2 not authenticated: {resp}");

    send_and_read(&mut conn2, &["AUTH", "secret123"]);
    let resp = send_and_read(&mut conn2, &["GET", "k"]);
    assert!(
        resp.contains("fromconn1"),
        "conn2 can read after auth: {resp}"
    );
}

#[test]
fn auth_missing_args() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["AUTH"]);
    assert!(
        resp.contains("ERR wrong number"),
        "AUTH needs password arg: {resp}"
    );
}

#[test]
fn hello_allowed_without_auth() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["HELLO"]);
    assert!(resp.contains("lux"), "HELLO allowed pre-auth: {resp}");
}

#[test]
fn hello_with_auth_authenticates() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["HELLO", "3", "AUTH", "default", "secret123"]);
    assert!(resp.contains("lux"), "HELLO returns server info: {resp}");

    let resp = send_and_read(&mut conn, &["SET", "k", "v"]);
    assert!(resp.contains("+OK"), "authenticated via HELLO: {resp}");
}

#[test]
fn hello_with_wrong_password_rejected() {
    let server = LuxServer::builder().password("secret123").start();
    let mut conn = server.conn();

    let resp = send_and_read(&mut conn, &["HELLO", "3", "AUTH", "default", "wrongpass"]);
    assert!(resp.contains("WRONGPASS"), "bad password in HELLO: {resp}");

    let resp = send_and_read(&mut conn, &["SET", "k", "v"]);
    assert!(resp.contains("NOAUTH"), "still locked out: {resp}");
}
