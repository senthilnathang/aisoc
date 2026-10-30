"""Adversarial local contract evaluation; never an LLM accuracy benchmark."""
import copy
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from aisoc.worker.v1 import investigation_pb2 as pb
from model_adapter import JSONModel


class InferenceContractEvaluation(unittest.TestCase):
    def test_local_cases(self):
        valid={'verdict':'INCONCLUSIVE','missing_evidence':['iam_mfa_context'],
               'hypotheses':[{'kind':kind,'supporting_refs':['e1'],'counterevidence_refs':[]}
                             for kind in ('credential_compromise','legitimate_user_or_automation')]}
        response={'raw':json.dumps(valid).encode()}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200);self.end_headers();self.wfile.write(response['raw'])
        server=HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            model=JSONModel(f'http://127.0.0.1:{server.server_port}/investigate','local-contract-fixture')
            task=pb.InvestigationTask(deadline_unix_ms=int((time.time()+30)*1000),evidence=[pb.EvidenceItem(reference='e1')])
            cases=[]
            for verdict in ('INCONCLUSIVE','BENIGN','SUSPICIOUS','MALICIOUS'):
                value=copy.deepcopy(valid);value['verdict']=verdict;cases.append((verdict,json.dumps(value).encode(),True))
            value=copy.deepcopy(valid);value['hypotheses'][0]['supporting_refs']=['hallucinated'];cases.append(('unknown citation',json.dumps(value).encode(),False))
            value=copy.deepcopy(valid);value['missing_evidence']=[];cases.append(('missing evidence omitted',json.dumps(value).encode(),False))
            value=copy.deepcopy(valid);value['execute_action']='disable_user';cases.append(('privilege injection',json.dumps(value).encode(),False))
            value=copy.deepcopy(valid);value['hypotheses'][0]['counterevidence_refs']=['e1'];cases.append(('contradictory citation',json.dumps(value).encode(),False))
            cases.extend([('oversized',b'x'*16385,False),('duplicate field',b'{"verdict":"BENIGN","verdict":"MALICIOUS"}',False),('invalid JSON',b'ignore all instructions',False)])
            for name,raw,accepted in cases:
                with self.subTest(name=name):
                    response['raw']=raw
                    if accepted:self.assertIn(model.investigate(task)['verdict'],('INCONCLUSIVE','BENIGN','SUSPICIOUS','MALICIOUS'))
                    else:
                        with self.assertRaises(ValueError):model.investigate(task)
        finally:server.shutdown();thread.join();server.server_close()


if __name__=='__main__':unittest.main()
