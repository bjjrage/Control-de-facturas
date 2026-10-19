import {afterEach,expect,it,vi} from 'vitest';
import {extractInvoiceFields} from '../invoice-extraction';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
it('preserves printed thousands and monetary decimals across header and mixed-tax lines',async()=>{
 vi.stubEnv('OPENAI_API_KEY','unit-test-key');
 const fetchMock=vi.fn(async(_input: RequestInfo | URL, _init?: RequestInit)=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({provider_name:'QA',provider_tax_id:'800000001',invoice_number:'001',invoice_date:'2026-10-17',subtotal:'300.000',vat:'20.000',total:'320.000',timbrado:null,order_reference:null,product_description:'Cemento',items:[{description:'Cemento',quantity:'2',unit:'bolsa',unit_price:'50.000',subtotal:'100.000'},{description:'Cal',quantity:'4',unit:'bolsa',unit_price:'50.000,25',subtotal:'200.001,00'}]})}}]})}));
 vi.stubGlobal('fetch',fetchMock);
 const result=await extractInvoiceFields(Buffer.from('fixture'),'image/png');
 expect(result.error).toBeNull();expect(result.data).toMatchObject({subtotal:300000,vat:20000,total:320000,items:[{unit_price:50000,subtotal:100000},{unit_price:50000.25,subtotal:200001}]});
 const request=JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
 expect(request.response_format.json_schema.schema.properties.total.type).toEqual(['string','null']);
});
it('leaves an unreadable printed monetary value empty instead of inventing it',async()=>{
 vi.stubEnv('OPENAI_API_KEY','unit-test-key');vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({subtotal:'ilegible',vat:null,total:'100.000',items:[{description:'QA',quantity:'2',unit:'un',unit_price:'no visible',subtotal:null}]})}}]})})));
 const result=await extractInvoiceFields(Buffer.from('fixture'),'image/png');expect(result.data?.subtotal).toBeNull();expect(result.data?.total).toBe(100000);expect(result.data?.items[0].unit_price).toBeNull();expect(result.data?.items[0].subtotal).toBeNull();
});
