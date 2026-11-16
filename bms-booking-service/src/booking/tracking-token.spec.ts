import { createTrackingToken,verifyTrackingToken } from './tracking-token';
describe('customer tracking capabilities',()=>{
  let old:string|undefined;
  beforeEach(()=>{old=process.env.CUSTOMER_TRACKING_SECRET;process.env.CUSTOMER_TRACKING_SECRET='test-only-tracking-secret-32-characters';});
  afterEach(()=>{if(old===undefined)delete process.env.CUSTOMER_TRACKING_SECRET;else process.env.CUSTOMER_TRACKING_SECRET=old;});
  it('binds each capability to its booking',()=>{const cap=createTrackingToken('booking-a');expect(verifyTrackingToken('booking-a',cap)).toBe(true);expect(verifyTrackingToken('booking-b',cap)).toBe(false);expect(verifyTrackingToken('booking-a','invalid')).toBe(false);});
  it('requires its dedicated secret',()=>{delete process.env.CUSTOMER_TRACKING_SECRET;expect(()=>createTrackingToken('booking-a')).toThrow('Customer tracking secret');});
});
