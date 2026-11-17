import { createHash,createHmac } from 'node:crypto';
import { WelincWebhookService } from './welinc-webhook.service';
describe('signed booking webhook authentication',()=>{
  const secret='test-only-webhook-secret-32-characters';
  const raw=Buffer.from('{ "eventType":"booking.cancelled.v1", "externalBookingId":"external-test", "occurredAt":"2026-11-16T00:00:00Z" }');
  let previousSecret:string|undefined;let previousKey:string|undefined;
  beforeEach(()=>{previousSecret=process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET;previousKey=process.env.BMS_WELINC_WEBHOOK_API_KEY;process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET=secret;delete process.env.BMS_WELINC_WEBHOOK_API_KEY;});
  afterEach(()=>{if(previousSecret===undefined)delete process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET;else process.env.BMS_WELINC_BOOKING_WEBHOOK_SECRET=previousSecret;if(previousKey===undefined)delete process.env.BMS_WELINC_WEBHOOK_API_KEY;else process.env.BMS_WELINC_WEBHOOK_API_KEY=previousKey;});
  function request(body=raw,age=0){const timestamp=String(Math.floor(Date.now()/1000)-age);const headers:Record<string,string>={'x-welinc-event-id':'event-test-001','x-welinc-timestamp':timestamp,'x-welinc-signature':'sha256='+createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex')};return {rawBody:body,header:(key:string)=>headers[key]} as any;}
  function service(){const tx={$queryRaw:async()=>[],welincWebhookEvent:{findUnique:async()=>({payloadSha256:createHash('sha256').update(raw).digest('hex'),result:'APPLIED'})}};return new WelincWebhookService({$transaction:async(work:any)=>work(tx)} as any,{} as any);}
  it('accepts the original whitespace-preserving bytes and deduplicates delivery',async()=>{await expect(service().receive(request())).resolves.toMatchObject({accepted:true,duplicate:true});});
  it('rejects a changed body even if the parsed JSON is identical',async()=>{await expect(service().receive(request(Buffer.from(JSON.stringify(JSON.parse(raw.toString())))))).rejects.toMatchObject({status:401});});
  it('rejects stale signed requests',async()=>{await expect(service().receive(request(raw,301))).rejects.toMatchObject({status:401});});
});
