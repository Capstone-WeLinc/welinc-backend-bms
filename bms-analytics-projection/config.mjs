export function workerConfig(raw) {
 const max=raw.DB_POOL_MAX === undefined || String(raw.DB_POOL_MAX).trim()===''?2:Number(raw.DB_POOL_MAX);
 const bad=[];
 if(!Number.isInteger(max)||max<1||max>50)bad.push('DB_POOL_MAX');
 if(raw.NODE_ENV==='production') {
  for(const name of ['BOOKING_API_URL','DISPATCH_API_URL','COMPLETION_API_URL']) {try { const u=new URL(raw[name]);if(u.protocol!=='https:'||['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(u.hostname)||u.hostname.endsWith('.localhost'))bad.push(name); }catch{bad.push(name);} }
  try { const u=new URL(raw.ANALYTICS_READ_MODEL_DATABASE_URL);if(!['postgresql:','postgres:'].includes(u.protocol)||(['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(u.hostname)||u.hostname.endsWith('.localhost'))||!['require','verify-full','verify-ca'].includes(u.searchParams.get('sslmode')))bad.push('ANALYTICS_READ_MODEL_DATABASE_URL'); }catch{bad.push('ANALYTICS_READ_MODEL_DATABASE_URL');}
 }
 if(bad.length)throw new Error('Invalid environment names: '+[...new Set(bad)].join(', '));
 return {max};
}
