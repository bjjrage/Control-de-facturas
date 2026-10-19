import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual private pure functions in client modules, also on the
// pre-fix source. No copied parser, new export or missing helper is required.
export function sourceFunctions(file: string, names: string[]): Record<string, (...args: any[]) => any> {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selected = ast.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text ?? "");
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.includes(d.name.text));
  }).map(statement => statement.getText(ast)).join("\n");
  const code = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(code + "\nreturn {" + names.join(",") + "};")();
}
