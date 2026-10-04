import type { Client, Empresa, SalesDocument, SalesDocumentItem } from "./types";
import { isGoekuaEmissionMotive, isFiscalCdc, type GoekuaFacturaPayload, type GoekuaCreditNotePayload } from "./goekua";
type Company = Pick<Empresa, "nombre" | "email_empresa">;
function required(value: string | null | undefined, name: string) {
  if (!value?.trim()) throw new Error(`Falta el dato fiscal ${name}. No se enviará a Goekua.`);
  return value.trim();
}
function configuredNumber(name: string, min: number) {
  const value = Number(required(process.env[name], name));
  if (!Number.isInteger(value) || value < min) throw new Error(`Configuración fiscal inválida: ${name}.`);
  return value;
}
function configuredChoice(name: string, choices: number[]) {
  const value = configuredNumber(name, 1);
  if (!choices.includes(value)) throw new Error(`Configuración fiscal no soportada: ${name}.`);
  return value;
}
function context(doc: SalesDocument, company: Company) {
  // V-xxxxx is internal numbering. Never strip/pad it to invent a fiscal number.
  if (!/^\d{7}$/.test(doc.code)) throw new Error("El documento no tiene un número fiscal de 7 dígitos. Su código interno no puede usarse como numeración fiscal.");
  const idSifen = required(process.env.GOEKUA_ESTABLISHMENT_ID, "GOEKUA_ESTABLISHMENT_ID");
  const pointOfExpedition = required(process.env.GOEKUA_POINT_OF_EXPEDITION, "GOEKUA_POINT_OF_EXPEDITION");
  if (!/^\d{3}$/.test(idSifen) || !/^\d{3}$/.test(pointOfExpedition)) throw new Error("Establecimiento y punto de expedición requieren 3 dígitos.");
  return { user: {
      name: required(process.env.GOEKUA_USER_NAME, "GOEKUA_USER_NAME"), lastName: required(process.env.GOEKUA_USER_LAST_NAME, "GOEKUA_USER_LAST_NAME"),
      email: required(process.env.GOEKUA_USER_EMAIL ?? company.email_empresa, "email del emisor"),
      documentType: configuredNumber("GOEKUA_USER_DOCUMENT_TYPE", 1), documentNumber: required(process.env.GOEKUA_USER_DOCUMENT_NUMBER, "GOEKUA_USER_DOCUMENT_NUMBER"),
    }, establishment: {
      idSifen, address: required(process.env.GOEKUA_ESTABLISHMENT_ADDRESS, "GOEKUA_ESTABLISHMENT_ADDRESS"),
      houseNumber: configuredNumber("GOEKUA_ESTABLISHMENT_HOUSE_NUMBER", 0), cityId: configuredNumber("GOEKUA_ESTABLISHMENT_CITY_ID", 1),
      phone: required(process.env.GOEKUA_ESTABLISHMENT_PHONE, "GOEKUA_ESTABLISHMENT_PHONE"), email: required(company.email_empresa, "email de la empresa"),
      denomination: required(process.env.GOEKUA_ESTABLISHMENT_NAME ?? company.nombre, "nombre del establecimiento"),
    }, pointOfExpedition, documentNumber:doc.code };
}
function validItems(items: SalesDocumentItem[]) {
  if (!items.length || items.some(i => !i.id || !i.description?.trim() || !Number.isFinite(i.quantity) || i.quantity <= 0 || !Number.isFinite(i.unit_price) || i.unit_price < 0 || ![0,5,10].includes(i.vat_rate))) throw new Error("Ítems fiscales inválidos.");
}
export function buildGoekuaInvoice(doc: SalesDocument, items: SalesDocumentItem[], client: Client, company: Company): GoekuaFacturaPayload {
  validItems(items); const common = context(doc, company);
  // The old adapter hardcoded commercial policy. Require an explicit integration
  // configuration; a document's internal lifecycle is not its payment condition.
  const transactionType = configuredChoice("GOEKUA_TRANSACTION_TYPE", [1,2,3,4,5,6,7,8,9,10,11,12,13]);
  const operationConditionType = configuredChoice("GOEKUA_OPERATION_CONDITION_TYPE", [1,2]);
  const emissionType = configuredChoice("GOEKUA_EMISSION_TYPE", [1,2]);
  const presenceIndicatorType = configuredChoice("GOEKUA_PRESENCE_INDICATOR_TYPE", [1,2,3,4,5,6,9]);
  // Only the existing cash integration is represented; card/cheque metadata is absent.
  const paymentType = configuredChoice("GOEKUA_PAYMENT_TYPE", [1]);
  if (!Number.isFinite(doc.total) || doc.total <= 0) throw new Error("Total fiscal inválido.");
  let expirationDate: string | undefined;
  if (operationConditionType === 2) {
    const dueDate = required(doc.due_date, "vencimiento de venta a crédito");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) throw new Error("Vencimiento fiscal inválido.");
    expirationDate = `${dueDate}T00:00:00.000Z`;
  }
  const currencyRate = doc.currency === "PYG" ? 1 : Number(required(process.env.GOEKUA_CURRENCY_RATE, "GOEKUA_CURRENCY_RATE"));
  if (!Number.isFinite(currencyRate) || currencyRate <= 0) throw new Error("Tipo de cambio fiscal inválido.");
  const measureUnit = configuredNumber("GOEKUA_MEASURE_UNIT", 1);
  const ruc = required(client.tax_id, "identificación fiscal del cliente");
  if (!/^\d+-\d$/.test(ruc)) throw new Error("El cliente no tiene RUC de contribuyente; falta representar su identificación fiscal de no contribuyente.");
  return { ...common, client: { ruc, businessName:required(client.name,"nombre del cliente"), address:required(client.address,"dirección del cliente"), isContributor:true,
      ...(client.email ? {email:client.email} : {}), ...(client.phone ? {phone:client.phone} : {}) },
    transactionType, operationConditionType, emissionType, presenceIndicatorType, currency:doc.currency,currencyRate,
    ...(expirationDate ? { expirationDate } : {}),
    items:items.map(i=>({code:i.id,description:i.description,measureUnit,amount:i.quantity,unitPrice:i.unit_price,
      unitDiscountPercentage:0,unitNetDiscount:0,taxPercentage:i.vat_rate===0?0:100,taxRate:i.vat_rate,ivaType:i.vat_rate===0?3:1})),
    paymentMethods:[{paymentType,charge:doc.total,currency:doc.currency,currencyRate}] };
}
export function buildGoekuaCreditNote(doc: SalesDocument, items: SalesDocumentItem[], company: Company,
  sourceCdc: string, motive: unknown, sourceItemIds: string[], sourceItems: SalesDocumentItem[]): GoekuaCreditNotePayload {
  if (!isFiscalCdc(sourceCdc)) throw new Error("La factura de origen debe estar emitida fiscalmente antes de emitir la NC.");
  if (!isGoekuaEmissionMotive(motive)) throw new Error("Seleccioná un motivo fiscal de NC válido (1–8).");
  validItems(items);
  // Human source item selection by exact ID; no inferred matching or allocation ledger.
  if (sourceItemIds.length!==items.length || sourceItemIds.some(id=>!sourceItems.some(i=>i.id===id))) throw new Error("Seleccioná el ítem de factura de origen para cada ítem de la NC.");
  return { ...context(doc,company), cdcElectronicDocumentAttached:sourceCdc,emissionMotive:motive,
    items:items.map((i,index)=>({code:sourceItemIds[index],amount:i.quantity,unitPrice:i.unit_price})) };
}
