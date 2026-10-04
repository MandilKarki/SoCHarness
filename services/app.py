"""Loopback-only local laboratory. Run: python services/app.py"""
import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from store import Store, Problem, ROOT, DB
from engine import Engine, ACTIVE, LOCK, cancel, capabilities
from advanced import Advanced, otlp_export
from access import Access, deployment_status
from passkeys import Passkeys
from firebase_login import FirebaseLogin

LOCAL_ACCESS = Access(mode='local')

class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32

    def __init__(self, address, access):
        self.access = access
        self.passkeys = Passkeys(access)
        self.firebase = FirebaseLogin()
        self.slots = threading.BoundedSemaphore(32)
        self.run_slots = threading.BoundedSemaphore(int(os.getenv('RELAY_MAX_RUNS', '2')))
        super().__init__(address, Handler)

    def process_request(self, request, address):
        request.settimeout(30)
        if not self.slots.acquire(blocking=False):
            try:request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request, address)
        except Exception:
            self.slots.release();raise

    def process_request_thread(self, request, address):
        try:super().process_request_thread(request, address)
        finally:self.slots.release()

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass

    def send_json(self,data,status=200,cookie=None):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        if cookie:self.send_header('Set-Cookie',cookie)
        self.headers_for('application/json; charset=utf-8',len(body));self.end_headers();self.wfile.write(body)

    def headers_for(self,kind,length=None):
        self.send_header('Content-Type',kind)
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        if self.access.mode=='pilot':self.send_header('Strict-Transport-Security','max-age=31536000')
        firebase = getattr(self.server, 'firebase', None)
        policy = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
        if firebase and firebase.config and urlparse(self.path).path == '/login':
            auth_origin = 'https://'+firebase.config['authDomain']
            policy = policy.replace("script-src 'self'", "script-src 'self' https://apis.google.com")
            policy = policy.replace("connect-src 'self'", "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com "+auth_origin)
            policy += '; frame-src '+auth_origin
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
        self.send_header('Content-Security-Policy',policy)
        if length is not None:self.send_header('Content-Length',str(length))

    @property
    def access(self):return getattr(self.server,'access',LOCAL_ACCESS)

    def guard(self,write=False):
        path=urlparse(self.path).path
        public=path in ('/api/health','/api/auth','/api/login','/api/login/google','/login','/login.js','/style.css','/refinement.css','/passkeys.js','/identity.css','/react-app.js','/react-app.css','/api/passkeys/authentication/options','/api/passkeys/authentication/verify')
        self.access.guard(self.headers,self.server.server_port,write,public)

    def cookie_response(self,cookie):
        self.send_response(200);self.send_header('Set-Cookie',cookie)
        self.headers_for('application/json',11);self.end_headers();self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        try:
            if urlparse(self.path).path in ('/', '/architecture', '/security') and self.access.mode=='pilot' and not self.access.authenticated(self.headers):
                self.access.guard(self.headers,self.server.server_port,public=True)
                target=urlparse(self.path).path.strip('/')
                destination='/login?next='+target if target in ('architecture','security') else '/login'
                self.send_response(303);self.send_header('Location',destination);self.headers_for('text/plain',0);self.end_headers();return
            self.guard()
            parsed=urlparse(self.path);path=parsed.path;query=parse_qs(parsed.query)
            parts=path.strip('/').split('/')
            if path=='/api/auth':return self.send_json({'mode':self.access.mode,'authenticated':self.access.mode=='local' or self.access.authenticated(self.headers),'passkeys_available':self.access.mode=='pilot',
                'firebase':getattr(getattr(self.server,'firebase',None),'config',None) if self.access.mode=='pilot' else None})
            if path=='/api/health':return self.send_json({'ok':True})
            with Store() as store:
                if path=='/api/passkeys':return self.send_json(self.server.passkeys.list(store,self.headers))
                if path=='/api/inventory':
                    from inventory import inventory
                    return self.send_json(inventory(store))
                if path=='/api/openai-contract':
                    from adapters.openai_observation import contract
                    from store import DEFAULT_CONFIG, TOOLS
                    config={**DEFAULT_CONFIG,'permission':'read_only','disabled_tools':[t['name'] for t in TOOLS if t['name'] not in ('query_case_evidence','get_event')]}
                    return self.send_json(contract(config))
                if path=='/api/deployment':
                    from trial_budget import TrialBudget
                    from anthropic_budget import AnthropicBudget
                    return self.send_json({**deployment_status(self.access),'trial':TrialBudget(store).snapshot(),
                                           'anthropic_trial':AnthropicBudget(store).snapshot()})
                if path=='/api/capabilities':return self.send_json(capabilities(store))
                if path=='/api/adapters':
                    from adapters.registry import catalog
                    return self.send_json(catalog(store))
                if path=='/api/incidents':return self.send_json(store.cases())
                if path=='/api/test-ground':
                    import test_ground
                    return self.send_json({**test_ground.catalog(),'results':test_ground.results(store),'prompt':test_ground.PROMPT})
                if path=='/api/grounding':
                    import grounding
                    return self.send_json({'review':grounding.review_session(store,query.get('session',[''])[0])})
                if path=='/api/knowledge':
                    import knowledge
                    return self.send_json(knowledge.catalog())
                if path=='/api/knowledge/case':
                    import knowledge
                    return self.send_json({'tree':knowledge.questions_for(query.get('case_id',[''])[0])})
                if path=='/api/test-ground/grade':
                    import test_ground
                    return self.send_json({'grade':test_ground.grade(store,query.get('session',[''])[0])})
                if path=='/api/sessions':return self.send_json(store.sessions())
                if path=='/api/events':
                    limit=int(query.get('limit',['25'])[0]);offset=int(query.get('offset',['0'])[0])
                    if not 1<=limit<=100 or offset<0:raise Problem('Invalid pagination')
                    return self.send_json(store.events(query.get('case_id',[''])[0],limit,offset,query.get('search',[''])[0]))
                if len(parts)>=3 and parts[:2]==['api','sessions']:
                    sid=parts[2];session=store.session(sid)
                    if len(parts)==3:return self.send_json({'session':session,'trace':store.traces(sid),'approvals':self.approvals(store,sid)})
                    if len(parts)==4 and parts[3]=='export':return self.send_json({'session':session,'trace':store.traces(sid),'approvals':self.approvals(store,sid)})
                    if len(parts)==4 and parts[3]=='advanced':
                        from workspace import snapshot
                        return self.send_json({**Advanced(store,sid).snapshot(),'workspace':snapshot(store,sid)})
                    if len(parts)==4 and parts[3]=='otel':return self.send_json(otlp_export(store,sid))
                    if len(parts)==4 and parts[3]=='workspace-file':
                        from workspace import read
                        return self.send_json(read(store,sid,query.get('name',[''])[0]))
                    if len(parts)==4 and parts[3]=='artifact':return self.send_json(Advanced(store,sid).execute('read_artifact',{'name':query.get('name',[''])[0]}))
                if path.startswith('/api/'):raise Problem('Endpoint not found',404)
            files={'/':'index.html','/app.js':'app.js','/advanced.js':'advanced.js','/frameworks.js':'frameworks.js','/catalog.js':'catalog.js','/style.css':'style.css','/refinement.css':'refinement.css','/login':'login.html','/login.js':'login.js'}
            files.update({'/guide.js':'guide.js','/guide.css':'guide.css','/architecture':'architecture.html','/architecture.js':'architecture.js','/architecture.css':'architecture.css'})
            files.update({'/passkeys.js':'passkeys.js','/security':'security.html','/security.js':'security.js','/identity.css':'identity.css','/experience.css':'experience.css','/experience.js':'experience.js'})
            # Public executable assets contain no data or credentials. APIs keep their existing guards.
            files.update({'/react-app.js':'react-app.js','/react-app.css':'react-app.css'})
            if path not in files:raise Problem('Not found',404)
            file=ROOT/'web'/files[path];body=file.read_bytes()
            self.send_response(200);self.headers_for(mimetypes.guess_type(file)[0]+'; charset=utf-8',len(body));self.end_headers();self.wfile.write(body)
        except (ValueError,TypeError):self.send_json({'error':'Invalid request'},400)
        except Problem as exc:self.send_json({'error':str(exc)},exc.status)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        except Exception as exc:
            print(type(exc).__name__,str(exc),flush=True)
            self.send_json({'error':'Internal error; see local server output'},500)

    @staticmethod
    def approvals(store,sid):
        return [dict(id=r['id'],tool=r['tool'],arguments=json.loads(r['arguments']),status=r['status']) for r in store.db.execute('SELECT * FROM relay_approvals WHERE session_id=? ORDER BY created_at',(sid,))]

    def do_POST(self):
        streaming=False
        run_slot=False
        try:
            self.guard(True)
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=32000:raise Problem('Request body must be 1–32000 bytes',413)
            body=json.loads(self.rfile.read(length))
            if not isinstance(body,dict):raise Problem('JSON object required')
            path=urlparse(self.path).path;parts=path.strip('/').split('/')
            if path=='/api/login':return self.cookie_response(self.access.login(body.get('token')))
            if path=='/api/login/google':return self.cookie_response(self.server.firebase.login(self.access,body.get('id_token')))
            if path=='/api/logout':return self.cookie_response(self.access.logout(self.headers))
            if path=='/api/passkeys/authentication/options':
                value,cookie=self.server.passkeys.authentication_options(self.headers)
                return self.send_json(value,cookie=cookie)
            with Store() as store:
                if path=='/api/passkeys/authentication/verify':return self.cookie_response(self.server.passkeys.authenticate(store,self.headers,body))
                if path=='/api/passkeys/registration/options':return self.send_json(self.server.passkeys.registration_options(store,self.headers,body))
                if path=='/api/passkeys/registration/verify':return self.send_json(self.server.passkeys.register(store,self.headers,body))
                if path=='/api/passkeys/remove':return self.send_json(self.server.passkeys.remove(store,self.headers,body))
                if path=='/api/adapters':
                    from adapters.registry import set_enabled
                    return self.send_json(set_enabled(store,body.get('id'),body.get('enabled')))
                if path=='/api/sessions':
                    config=body.get('config',{})
                    if not isinstance(config,dict):raise Problem('Configuration must be an object')
                    from adapters.registry import ensure_ready
                    ensure_ready(store,config.get('runtime','simulator'))
                    return self.send_json(store.create(body.get('case_id'),config,body.get('title')),201)
                if len(parts)!=4 or parts[:2]!=['api','sessions']:raise Problem('Endpoint not found',404)
                sid,action=parts[2:];session=store.session(sid)
                if action=='cancel':cancel(sid);return self.send_json({'cancellation_requested':True})
                if action=='answer':return self.send_json(Advanced(store,sid).answer(body.get('id'),body.get('answer')))
                if action=='question':
                    if session['config']['runtime']!='simulator' or session['status']!='idle':raise Problem('Manual questions are a replay-only demonstration',409)
                    return self.send_json({'id':Advanced(store,sid).ask(body.get('question'))})
                if action=='approval':
                    # A running SDK tool may be awaiting this exact decision. Do not reset its run state.
                    with LOCK:stop=ACTIVE.get(sid)
                    if stop and stop.is_set():raise Problem('Run is cancelling; approval rejected',409)
                    owns_lock=session['status']=='idle'
                    if owns_lock:store.begin(sid)
                    try:return self.send_json(Engine(store,sid,cancelled=stop).approve(body.get('id'),body.get('decision')))
                    finally:
                        if owns_lock:store.status(sid,'idle')
                if session['status']!='idle':raise Problem('Session is currently running',409)
                if action=='compact':return self.send_json(store.compact(sid))
                if action=='fork':return self.send_json(store.fork(sid,body.get('seq')),201)
                if action in ('tool','approval'):
                    store.begin(sid)
                    try:
                        engine=Engine(store,sid)
                        result=engine.call(body.get('tool'),body.get('arguments',{})) if action=='tool' else engine.approve(body.get('id'),body.get('decision'))
                        return self.send_json(result)
                    finally:store.status(sid,'idle')
                if action!='messages':raise Problem('Endpoint not found',404)
                prompt=body.get('message')
                if not isinstance(prompt,str) or not 1<=len(prompt.strip())<=12000:raise Problem('Message must contain 1–12000 characters')
                if session['config']['runtime']=='claude' and not capabilities()['runtimes'][1]['available']:raise Problem('Claude runtime unavailable',409)
                if hasattr(self.server,'run_slots'):
                    run_slot=self.server.run_slots.acquire(blocking=False)
                    if not run_slot:raise Problem('Agent capacity reached. Retry after an active run finishes.',429)
                store.begin(sid);stop=threading.Event()
                with LOCK:ACTIVE[sid]=stop
                self.send_response(200);self.headers_for('application/x-ndjson; charset=utf-8');self.end_headers();streaming=True
                def emit(event):
                    try:self.wfile.write((json.dumps(event)+'\n').encode());self.wfile.flush()
                    except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):stop.set()
                try:Engine(store,sid,emit,stop).run(prompt.strip())
                finally:
                    with LOCK:ACTIVE.pop(sid,None)
                self.close_connection=True
        except (ValueError,TypeError):
            if not streaming:self.send_json({'error':'Invalid request'},400)
        except Problem as exc:
            if not streaming:self.send_json({'error':str(exc)},exc.status)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
        except Exception as exc:
            print(type(exc).__name__,str(exc),flush=True)
            if not streaming:self.send_json({'error':'Internal error; see local server output'},500)
        finally:
            if run_slot:self.server.run_slots.release()

if __name__=='__main__':
    access=Access()
    bind=os.getenv('RELAY_BIND','127.0.0.1' if access.mode=='local' else '0.0.0.0')
    if access.mode=='local' and bind not in ('127.0.0.1','localhost'):raise SystemExit('Public binding requires authenticated pilot mode')
    if not DB.exists():raise SystemExit('Evidence DB missing. Run python services/import_corpus.py PATH_TO_SAMPLE_ZIP first. Existing databases are never overwritten.')
    with Store() as store:store.initialize();store.recover()
    port=int(os.getenv('PORT','8787'))
    print('Relay ISOC: '+(access.origin or f'http://127.0.0.1:{port}')+' ('+access.mode+')',flush=True)
    Server((bind,port),access).serve_forever()
