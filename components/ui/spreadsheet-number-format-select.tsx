"use client";
import {Label,Select} from "./input";
import type {SpreadsheetNumberFormat} from "@/lib/spreadsheet-number-format";

export function SpreadsheetNumberFormatSelect({id,value,onChange}:{id:string;value:SpreadsheetNumberFormat;onChange:(value:SpreadsheetNumberFormat)=>void}) {
 return <div className="space-y-1">
  <Label htmlFor={id}>Formato de números de texto</Label>
  <Select id={id} value={value} onChange={event=>onChange(event.target.value==="py"?"py":"strict")} className="h-8 text-xs">
   <option value="strict">Estricto: bloquear ambigüedades</option>
   <option value="py">Paraguay: punto de miles y coma decimal (350.000 = 350000)</option>
  </Select>
 </div>;
}
