use wasmi::{Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder};

const UPPER: &str = r#"(module
 (memory (export "memory") 1 1)
 (func (export "transform") (param $len i32) (local $i i32) (local $c i32)
  (block $end (loop $loop
   (br_if $end (i32.ge_u (local.get $i) (local.get $len)))
   (local.set $c (i32.load8_u (local.get $i)))
   (if (i32.and (i32.ge_u (local.get $c) (i32.const 97)) (i32.le_u (local.get $c) (i32.const 122)))
    (then (i32.store8 (local.get $i) (i32.sub (local.get $c) (i32.const 32)))))
   (local.set $i (i32.add (local.get $i) (i32.const 1)))
   (br $loop)))))"#;

pub fn upper(input: &[u8]) -> Result<Vec<u8>, String> {
    execute(UPPER, input, 2_000_000)
}

// Only an embedded, allowlisted module is accepted by the RPC. No WASI, imports,
// filesystem, network, clocks, or environment are linked into the instance.
fn execute(source: &str, input: &[u8], fuel: u64) -> Result<Vec<u8>, String> {
    if input.len() > 65536 {
        return Err("input too large".into());
    }
    let mut config = Config::default();
    config.consume_fuel(true);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, source).map_err(|_| "invalid module")?;
    if module.imports().next().is_some() {
        return Err("imports forbidden".into());
    }
    let limits = StoreLimitsBuilder::new()
        .memory_size(65536)
        .memories(1)
        .tables(0)
        .instances(1)
        .build();
    let mut store = Store::new(&engine, limits);
    store.limiter(|limits| limits);
    store.set_fuel(fuel).map_err(|_| "fuel unavailable")?;
    let linker = Linker::<StoreLimits>::new(&engine);
    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .map_err(|_| "instantiation denied")?;
    let memory = instance
        .get_memory(&store, "memory")
        .ok_or("memory missing")?;
    memory
        .write(&mut store, 0, input)
        .map_err(|_| "input bounds")?;
    instance
        .get_typed_func::<i32, ()>(&store, "transform")
        .map_err(|_| "invalid export")?
        .call(&mut store, input.len() as i32)
        .map_err(|_| "execution trapped or exhausted fuel")?;
    let mut output = vec![0; input.len()];
    memory
        .read(&store, 0, &mut output)
        .map_err(|_| "output bounds")?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic_and_bounded() {
        assert_eq!(upper(b"hello World\0\xff").unwrap(), b"HELLO WORLD\0\xff");
        assert_eq!(upper(&vec![b'a'; 65536]).unwrap(), vec![b'A'; 65536]);
        assert!(upper(&vec![0; 65537]).is_err());
        assert!(execute(UPPER, b"hello", 1).is_err());
        assert!(
            execute(
                r#"(module (memory (export "memory") 2) (func (export "transform") (param i32)))"#,
                b"",
                100
            )
            .is_err()
        );
        assert!(
            execute(
                r#"(module (import "env" "call" (func)) (memory (export "memory") 1))"#,
                b"",
                100
            )
            .is_err()
        );
        assert!(execute(r#"(module (memory (export "memory") 1) (func (export "transform") (param i32) (loop $again (br $again))))"#,b"",100).is_err());
    }
}
