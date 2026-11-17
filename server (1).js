// FuzSuc — Fuzcraft sunucu barındırma sitesi (Aternos gibi). Bağımlılıksız, sadece Node.js 16+.  Çalıştır: node server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000;
const DATA=process.env.DATA_DIR||path.join(__dirname,'data');
const MAX_SERVERS=+process.env.MAX_SERVERS||100;     // toplam oluşturulabilecek sunucu
const MAX_ONLINE=+process.env.MAX_ONLINE||15;        // aynı anda açık sunucu
const MAX_PLAYERS=+process.env.MAX_PLAYERS||10;      // sunucu başına oyuncu
const IDLE_MIN=+process.env.IDLE_MIN||10;            // bu kadar dakika boş kalırsa otomatik kapanır
let DATA_OK=DATA;try{fs.mkdirSync(DATA,{recursive:true});fs.accessSync(DATA,fs.constants.W_OK)}catch(e){DATA_OK=path.join(require('os').tmpdir(),'fuzsuc-data');fs.mkdirSync(DATA_OK,{recursive:true});console.warn('data klasörü yazılamıyor, geçici klasör kullanılıyor:',DATA_OK)}
process.on('uncaughtException',e=>console.error('hata:',e&&e.stack||e));
const strHash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h|0};
const ALPHA='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode=()=>{let c;do{c='';for(let i=0;i<6;i++)c+=ALPHA[crypto.randomInt(ALPHA.length)]}while(srv.has(c));return c};

/* ---- sunucu kayıtları ---- */
const srv=new Map(); // code -> {code,name,mode,seed,token,created,edits:Map,room:null,dirty}
function fileOf(c){return path.join(DATA_OK,c+'.json')}
function saveSrv(s){if(!s.dirty)return;s.dirty=false;try{fs.writeFileSync(fileOf(s.code)+'.tmp',JSON.stringify({code:s.code,name:s.name,mode:s.mode,seed:s.seed,token:s.token,created:s.created,edits:[...s.edits.values()]}));fs.renameSync(fileOf(s.code)+'.tmp',fileOf(s.code))}catch(e){console.error('kayıt hatası',e.message)}}
for(const f of fs.readdirSync(DATA_OK)){if(!/^[A-Z0-9]{6}\.json$/.test(f))continue;try{const d=JSON.parse(fs.readFileSync(path.join(DATA_OK,f),'utf8'));
  srv.set(d.code,{code:d.code,name:d.name,mode:d.mode,seed:d.seed,token:d.token,created:d.created,edits:new Map(d.edits.map(e=>[e[0]+','+e[1]+','+e[2],e])),room:null,dirty:false})}catch(e){}}
setInterval(()=>{for(const s of srv.values())saveSrv(s)},10000);
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const s of srv.values())saveSrv(s);process.exit(0)});
const online=()=>[...srv.values()].filter(s=>s.room).length;
function startSrv(s){if(s.room)return true;if(online()>=MAX_ONLINE)return false;s.room={players:new Map(),nextId:1,lastActive:Date.now()};console.log('▶',s.name,s.code);return true}
function stopSrv(s){if(!s.room)return;for(const p of [...s.room.players.values()]){try{p.sock.write(frame(8,Buffer.alloc(0)))}catch(e){}kill(p,true)}s.room=null;saveSrv(s);console.log('■',s.name,s.code)}
setInterval(()=>{for(const s of srv.values())if(s.room&&s.room.players.size===0&&Date.now()-s.room.lastActive>IDLE_MIN*60000)stopSrv(s)},30000);
const pub=s=>({code:s.code,name:s.name,mode:s.mode,online:!!s.room,players:s.room?s.room.players.size:0,max:MAX_PLAYERS});

/* ---- HTTP ---- */
const read=f=>{try{return fs.readFileSync(path.join(__dirname,f))}catch(e){return null}};
const ipHits=new Map();
function json(res,code,obj){res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function body(req,cb){let b='';req.on('data',d=>{b+=d;if(b.length>4096)req.destroy()});req.on('end',()=>{try{cb(JSON.parse(b||'{}'))}catch(e){cb({})}})}
const http_=http.createServer((req,res)=>{try{route(req,res)}catch(e){console.error(e);try{json(res,500,{error:'Sunucu hatası: '+e.message})}catch(_){}}});
function route(req,res){
  const u=req.url.split('?')[0],m=req.method;
  if(m==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
  if(m==='GET'&&(u==='/'||u==='/panel')){const b=read('panel.html');if(!b){res.writeHead(404);return res.end('panel.html yok')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(b)}
  if(m==='GET'&&(u==='/game'||u==='/index.html')){const b=read('index.html');if(!b){res.writeHead(404);return res.end('index.html yok')}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(b)}
  let r;
  if(m==='POST'&&u==='/api/create')return body(req,d=>{
    const ip=req.socket.remoteAddress,now=Date.now(),h=(ipHits.get(ip)||[]).filter(t=>now-t<3600e3);
    if(h.length>=10)return json(res,429,{error:'Çok fazla sunucu oluşturdun, biraz bekle'});
    if(srv.size>=MAX_SERVERS)return json(res,503,{error:'Sunucu kotası dolu'});
    const name=String(d.name||'').replace(/[^\w çğıöşüÇĞİÖŞÜ.-]/g,'').trim().slice(0,24)||'Fuzcraft Dünyam';
    const mode=d.mode==='creative'?'creative':'survival';
    let seed;const sd=String(d.seed||'').trim();seed=!sd?(Math.random()*2147483647)|0:/^-?\d+$/.test(sd)?parseInt(sd,10)|0:strHash(sd);
    const s={code:newCode(),name,mode,seed,token:crypto.randomBytes(16).toString('hex'),created:now,edits:new Map(),room:null,dirty:true};
    srv.set(s.code,s);saveSrv(s);h.push(now);ipHits.set(ip,h);json(res,200,{...pub(s),token:s.token})});
  if((r=u.match(/^\/api\/s\/([A-Z0-9]{6})(?:\/(start|stop|delete))?$/))){
    const s=srv.get(r[1]);if(!s)return json(res,404,{error:'Sunucu bulunamadı'});
    if(m==='GET'&&!r[2])return json(res,200,pub(s));
    if(m==='POST'&&r[2])return body(req,d=>{
      if(d.token!==s.token)return json(res,403,{error:'Yetkin yok'});
      if(r[2]==='start'){if(!startSrv(s))return json(res,503,{error:'Şu an çok fazla sunucu açık, birazdan tekrar dene'})}
      else if(r[2]==='stop')stopSrv(s);
      else{stopSrv(s);srv.delete(s.code);try{fs.unlinkSync(fileOf(s.code))}catch(e){}return json(res,200,{deleted:true})}
      json(res,200,pub(s))});
  }
  res.writeHead(404);res.end('yok');
}

/* ---- minimal WebSocket (RFC 6455) ---- */
function frame(op,data){const len=data.length;let h;
  if(len<126){h=Buffer.from([0x80|op,len])}else if(len<65536){h=Buffer.alloc(4);h[0]=0x80|op;h[1]=126;h.writeUInt16BE(len,2)}else{h=Buffer.alloc(10);h[0]=0x80|op;h[1]=127;h.writeBigUInt64BE(BigInt(len),2)}
  return Buffer.concat([h,data])}
function send(p,o){if(p.dead)return;try{p.sock.write(frame(1,Buffer.from(typeof o==='string'?o:JSON.stringify(o))))}catch(e){}}
function bcast(s,o,except){const t=JSON.stringify(o);for(const p of s.room.players.values())if(p!==except&&p.ready)send(p,t)}
http_.on('upgrade',(req,sock)=>{
  const r=req.url.split('?')[0].match(/^\/ws\/([A-Za-z0-9]{6})$/),key=req.headers['sec-websocket-key'];
  const s=r&&srv.get(r[1].toUpperCase());
  const rej=(c,t)=>sock.end('HTTP/1.1 '+c+' '+t+'\r\nConnection: close\r\n\r\n');
  if(!key||!s)return rej(404,'Not Found');
  if(!s.room)return rej(503,'Server Offline');
  if(s.room.players.size>=MAX_PLAYERS)return rej(503,'Server Full');
  const acc=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acc+'\r\n\r\n');sock.setNoDelay(true);
  const p={id:s.room.nextId++,s,sock,name:'Oyuncu',ready:false,dead:false,buf:Buffer.alloc(0),msgs:0,win:Date.now()};
  s.room.players.set(p.id,p);
  sock.on('data',d=>{p.buf=Buffer.concat([p.buf,d]);if(p.buf.length>4e6){kill(p);return}parse(p)});
  sock.on('close',()=>kill(p));sock.on('error',()=>kill(p));
});
function kill(p,silent){if(p.dead)return;p.dead=true;const s=p.s;try{p.sock.destroy()}catch(e){}if(!s.room)return;s.room.players.delete(p.id);s.room.lastActive=Date.now();
  if(p.ready&&!silent){bcast(s,{t:'bye',id:p.id});bcast(s,{t:'chat',m:p.name+' oyundan ayrıldı'});console.log('-',s.code,p.name)}}
function parse(p){
  for(;;){const b=p.buf;if(b.length<2)return;const op=b[0]&15,masked=b[1]&128;let len=b[1]&127,off=2;
    if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4}else if(len===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));off=10}
    if(len>2e6){kill(p);return}
    const need=off+(masked?4:0)+len;if(b.length<need)return;
    let pl=b.slice(off+(masked?4:0),need);
    if(masked){const mk=b.slice(off,off+4);pl=Buffer.from(pl);for(let i=0;i<pl.length;i++)pl[i]^=mk[i&3]}
    p.buf=b.slice(need);
    if(op===8){try{p.sock.write(frame(8,Buffer.alloc(0)))}catch(e){}kill(p);return}
    if(op===9){try{p.sock.write(frame(10,pl))}catch(e){}continue}
    if(op===1)onMsg(p,pl.toString('utf8'));
  }
}
const num=(v,lo,hi)=>typeof v==='number'&&isFinite(v)&&v>=lo&&v<=hi;
function onMsg(p,txt){
  const s=p.s,now=Date.now();if(now-p.win>1000){p.win=now;p.msgs=0}if(++p.msgs>300)return;
  let m;try{m=JSON.parse(txt)}catch(e){return}
  if(m.t==='join'){if(p.ready)return;p.name=String(m.name||'Oyuncu').replace(/[^\w çğıöşüÇĞİÖŞÜ.-]/g,'').slice(0,16)||'Oyuncu';p.ready=true;
    send(p,{t:'hello',id:p.id,seed:s.seed,creative:s.mode==='creative',name:s.name,edits:[...s.edits.values()],players:[...s.room.players.values()].filter(q=>q.ready&&q!==p).map(q=>({id:q.id,name:q.name}))});
    bcast(s,{t:'join',id:p.id,name:p.name},p);bcast(s,{t:'chat',m:p.name+' oyuna katıldı'},p);console.log('+',s.code,p.name);return}
  if(!p.ready)return;
  if(m.t==='p'){if(!num(m.x,-3e7,3e7)||!num(m.y,-100,500)||!num(m.z,-3e7,3e7))return;bcast(s,{t:'p',id:p.id,x:m.x,y:m.y,z:m.z,yaw:+m.yaw||0,pitch:+m.pitch||0,s:m.s?1:0},p)}
  else if(m.t==='b'){if(![m.x,m.y,m.z,m.i].every(Number.isInteger)||m.y<0||m.y>=96||m.i<0||m.i>4095||!Number.isInteger(m.m||0))return;
    const meta=m.m|0;s.edits.set(m.x+','+m.y+','+m.z,[m.x,m.y,m.z,m.i,meta]);s.dirty=true;bcast(s,{t:'b',x:m.x,y:m.y,z:m.z,i:m.i,m:meta},p)}
  else if(m.t==='chat'){const c=String(m.m||'').slice(0,120);if(c)bcast(s,{t:'chat',m:p.name+': '+c})}
}
http_.listen(PORT,()=>console.log('FuzSuc hazır → http://localhost:'+PORT+'  (veri: '+DATA_OK+')'));
