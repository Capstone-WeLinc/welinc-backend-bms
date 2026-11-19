import {normalizePaymentMethod} from './welinc-webhook.service';
describe('webhook payment words',()=>{it('recognizes BDO and COD at word boundaries',()=>{expect(normalizePaymentMethod('BDO')).toBe('BDO');expect(normalizePaymentMethod('COD')).toBe('COD');});});
