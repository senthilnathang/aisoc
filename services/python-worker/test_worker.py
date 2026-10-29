import unittest
import grpc
from unittest.mock import patch
from worker import Worker
from aisoc.worker.v1.worker_pb2 import ExecuteRequest

class Context:
    def __init__(self, token='x'*32): self.token = token
    def invocation_metadata(self): return [('authorization', 'Bearer '+self.token)]
    def is_active(self): return True
    def abort(self, code, message): raise RuntimeError(code, message)

class WorkerTests(unittest.TestCase):
    def test_identity_and_normalization(self):
        request=ExecuteRequest(tenant_id='a',job_id='job',attempt_id='attempt',plugin_id='python.normalize',plugin_version='1',input=b'  HELLO   world ')
        response=Worker('x'*32).Execute(request, Context())
        self.assertEqual(response.output,b'hello world')
        self.assertEqual(response.tenant_id,'a')
        with self.assertRaises(RuntimeError): Worker('x'*32).Execute(request,Context('wrong'))
        request.input=b'\xff'
        with self.assertRaises(RuntimeError): Worker('x'*32).Execute(request,Context())
        request.input=b'ok';request.plugin_id='arbitrary.module'
        with self.assertRaises(RuntimeError): Worker('x'*32).Execute(request,Context())
    def test_bounded_input_and_plugin_allowlist(self):
        request=ExecuteRequest(tenant_id='a',job_id='job',attempt_id='attempt',plugin_id='python.normalize',plugin_version='1',input=b'x'*65537)
        with self.assertRaises(RuntimeError): Worker('x'*32).Execute(request,Context())

    def test_cancelled_request_does_not_start_plugin(self):
        request=ExecuteRequest(tenant_id='a',job_id='job',attempt_id='attempt',plugin_id='python.normalize',plugin_version='1',input=b'ok')
        context=Context()
        context.is_active=lambda:False
        with patch('worker.subprocess.Popen') as spawn:
            with self.assertRaises(RuntimeError): Worker('x'*32).Execute(request,context)
            spawn.assert_not_called()

    def test_deadline_and_midflight_cancellation_reap_child(self):
        request=ExecuteRequest(tenant_id='a',job_id='job',attempt_id='attempt',plugin_id='python.normalize',plugin_version='1',input=b'ok')
        for cancelled in (False,True):
            context=Context()
            active=iter([True,False] if cancelled else [True,True])
            context.is_active=lambda:next(active)
            with patch('worker.subprocess.Popen') as spawn, patch('worker.time.monotonic',side_effect=[0,4]):
                process=spawn.return_value
                process.poll.return_value=None
                with self.assertRaises(RuntimeError) as error: Worker('x'*32).Execute(request,context)
                self.assertEqual(error.exception.args[0],grpc.StatusCode.CANCELLED if cancelled else grpc.StatusCode.DEADLINE_EXCEEDED)
                process.kill.assert_called_once()
                process.wait.assert_called_once()
                process.communicate.assert_not_called()

if __name__=='__main__': unittest.main()
