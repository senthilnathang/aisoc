fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto = "../../contracts/proto/aisoc/worker/v1/worker.proto";
    println!("cargo:rerun-if-changed={proto}");
    let mut config = tonic_prost_build::Config::new();
    config.protoc_executable(protoc_bin_vendored::protoc_bin_path()?);
    tonic_prost_build::configure()
        .build_client(false)
        .compile_with_config(config, &[proto], &["../../contracts/proto"])?;
    Ok(())
}
