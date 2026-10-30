import { expect, it } from "vitest";
import { aggregateLinkedSchedule } from "../linked-schedule";
import type { LinkedRecipes } from "../linked-recipes";
import type { WorkbookBudgetItem } from "../types";
it("reconciles every item's monthly amounts before deriving the whole-work curve", () => {
  const items = [{ code:"1",quantity:2,unitPrice:100 },{code:"2",quantity:1,unitPrice:100}] as WorkbookBudgetItem[];
  const linked: LinkedRecipes = {recipes:[],issues:[],formulaCount:0,relativeSchedule:items.map((item,index) => ({ budgetCode:item.code!,startDay:1,endDay:30,source:{sheet:"Programa",row:index+2},monthlyValues:[{month:1,value:index?0:200,cell:"D2"},{month:2,value:index?100:0,cell:"E2"}] }))};
  const curve = aggregateLinkedSchedule(items, linked)!;
  expect(curve.months.map(month => month.programadoPct)).toEqual([200/300*100,100/300*100]);
  expect(curve.months.reduce((sum,month)=>sum+month.programadoPct,0)).toBeCloseTo(100);
  linked.relativeSchedule[1].monthlyValues[1].value=90;
  expect(aggregateLinkedSchedule(items,linked)).toBeNull(); expect(linked.issues.join()).toContain("no reproduce");
});
