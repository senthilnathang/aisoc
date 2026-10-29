use sha2::{Digest, Sha256};
mod sandbox;
use std::{net::SocketAddr, time::Duration};
use subtle::ConstantTimeEq;
use tonic::{Request, Response, Status, transport::Server};
mod protocol {
    tonic::include_proto!("aisoc.worker.v1");
}
use protocol::{
    ExecuteRequest, ExecuteResponse,
    worker_server::{Worker, WorkerServer},
};

struct Runtime {
    token_hash: [u8; 32],
    slots: tokio::sync::Semaphore,
}
#[tonic::async_trait]
impl Worker for Runtime {
    async fn execute(
        &self,
        request: Request<ExecuteRequest>,
    ) -> Result<Response<ExecuteResponse>, Status> {
        let _slot = self
            .slots
            .try_acquire()
            .map_err(|_| Status::resource_exhausted("worker busy"))?;
        let credential = request
            .metadata()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let supplied: [u8; 32] = Sha256::digest(credential.as_bytes()).into();
        if !bool::from(supplied.ct_eq(&self.token_hash)) {
            return Err(Status::unauthenticated("invalid worker credential"));
        }
        let r = request.into_inner();
        if [&r.tenant_id, &r.job_id, &r.attempt_id]
            .iter()
            .any(|v| v.is_empty() || v.len() > 120)
            || r.input.len() > 65536
        {
            return Err(Status::invalid_argument("invalid identity or payload size"));
        }
        if !["rust.sha256", "rust.wasm_ascii_upper"].contains(&r.plugin_id.as_str())
            || r.plugin_version != "1"
        {
            return Err(Status::unimplemented("unknown plugin version"));
        }
        let output = if r.plugin_id == "rust.wasm_ascii_upper" {
            sandbox::upper(&r.input)
                .map_err(|_| Status::resource_exhausted("WASM execution limit"))?
        } else {
            format!("{:x}", Sha256::digest(&r.input)).into_bytes()
        };
        Ok(Response::new(ExecuteResponse {
            tenant_id: r.tenant_id,
            job_id: r.job_id,
            attempt_id: r.attempt_id,
            plugin_id: r.plugin_id,
            plugin_version: r.plugin_version,
            output,
        }))
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = std::env::var("AISOC_RUST_ADDR")
        .unwrap_or("127.0.0.1:50052".into())
        .parse()?;
    if !addr.ip().is_loopback() || addr.port() == 0 {
        return Err("framework RPC must bind loopback".into());
    }
    let token = std::env::var("AISOC_WORKER_TOKEN")?;
    if token.len() < 32 {
        return Err("worker token must contain at least 32 characters".into());
    }
    let token_hash = Sha256::digest(format!("Bearer {token}").as_bytes()).into();
    let service = WorkerServer::new(Runtime {
        token_hash,
        slots: tokio::sync::Semaphore::new(4),
    })
    .max_decoding_message_size(70000)
    .max_encoding_message_size(70000);
    eprintln!("Rust worker listening on {addr}; embedded WASM plugin has fuel and memory limits");
    Server::builder()
        .concurrency_limit_per_connection(4)
        .timeout(Duration::from_secs(5))
        .add_service(service)
        .serve_with_shutdown(addr, async {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("signal handler");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(input: Vec<u8>) -> Request<ExecuteRequest> {
        let mut r = Request::new(ExecuteRequest {
            tenant_id: "a".into(),
            job_id: "job".into(),
            attempt_id: "attempt".into(),
            plugin_id: "rust.sha256".into(),
            plugin_version: "1".into(),
            input,
        });
        r.metadata_mut()
            .insert("authorization", "Bearer fixture".parse().unwrap());
        r
    }
    #[tokio::test]
    async fn bounds_identity_and_authentication() {
        let runtime = Runtime {
            token_hash: Sha256::digest(b"Bearer fixture").into(),
            slots: tokio::sync::Semaphore::new(1),
        };
        let response = runtime
            .execute(request(b"hello".to_vec()))
            .await
            .unwrap()
            .into_inner();
        assert_eq!(
            response.output,
            format!("{:x}", Sha256::digest(b"hello")).into_bytes()
        );
        assert_eq!(response.tenant_id, "a");
        assert_eq!(
            runtime
                .execute(request(vec![0; 65537]))
                .await
                .unwrap_err()
                .code(),
            tonic::Code::InvalidArgument
        );
        let mut wrong = request(vec![]);
        wrong.metadata_mut().clear();
        assert_eq!(
            runtime.execute(wrong).await.unwrap_err().code(),
            tonic::Code::Unauthenticated
        );
        let mut unknown = request(vec![]);
        unknown.get_mut().plugin_id = "load-arbitrary-wasm".into();
        assert_eq!(
            runtime.execute(unknown).await.unwrap_err().code(),
            tonic::Code::Unimplemented
        );
    }
}
