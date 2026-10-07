/**
 * tools/check-imports.mjs — 零依赖 ES 模块静态校验
 * 逐个解析 js 目录下全部 .js 文件的 import / export-from 语句，校验：
 *   1. 相对路径可解析（文件存在）
 *   2. 具名导入在目标模块的导出集合中存在（含 `export * from` 传递链）
 * 用于在无构建、无测试框架的前提下防止"导入不存在的导出"这类静默运行时错误
 * （例如历史上 dialogs.js 调用未导入的 updateRouteSelectOptions）。
 *
 * 用法：node tools/check-imports.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const JS_ROOT = join(ROOT, 'js');

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, out);
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}

const files = walk(JS_ROOT);

/** 解析规范说明符 → 绝对文件路径 */
function resolveSpecifier(fromFile, spec) {
    if (!spec.startsWith('.')) return null; // 裸标识符（无第三方依赖，忽略）
    let target = resolve(dirname(fromFile), spec);
    if (!existsSync(target) && existsSync(target + '.js')) target += '.js';
    if (!existsSync(target) && existsSync(join(target, 'index.js'))) target = join(target, 'index.js');
    return target;
}

const importRe = /import\s+(?:([\w$]+)\s*,\s*)?(?:(\{[^}]*\})|(\*\s+as\s+[\w$]+)|([\w$]+))?\s*from\s*['"]([^'"]+)['"]/g;
const sideEffectRe = /import\s*['"]([^'"]+)['"]/g;
const exportFromRe = /export\s+(?:\{([^}]*)\}|\*)\s*from\s*['"]([^'"]+)['"]/g;
const exportDeclRe = /export\s+(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/g;
const exportVarRe = /export\s+(?:const|let|var)\s+([\s\S]*?);/g;
const exportNamedRe = /export\s*\{([^}]*)\}(?!\s*from)/g;

/** 收集某文件的导出名（不含星号传递） */
function ownExports(source) {
    const names = new Set();
    for (const m of source.matchAll(exportDeclRe)) names.add(m[1]);
    for (const m of source.matchAll(exportVarRe)) {
        for (const name of declaredNames(m[1])) names.add(name);
    }
    for (const m of source.matchAll(exportNamedRe)) {
        for (const part of m[1].split(',')) {
            const piece = part.trim();
            if (!piece) continue;
            const asMatch = piece.match(/\bas\s+([\w$]+)$/);
            names.add(asMatch ? asMatch[1] : piece.split(/\s+/)[0]);
        }
    }
    for (const m of source.matchAll(exportFromRe)) {
        if (m[1]) {
            for (const part of m[1].split(',')) {
                const piece = part.trim();
                if (!piece) continue;
                const asMatch = piece.match(/\bas\s+([\w$]+)$/);
                names.add(asMatch ? asMatch[1] : piece.split(/\s+/)[0]);
            }
        }
    }
    if (/export\s+default\b/.test(source)) names.add('default');
    return names;
}

/**
 * 从声明语句文本中提取所有声明名（支持 `a = 1, b = 2` 形式，
 * 通过括号深度与引号状态区分初始化表达式内部的逗号）。
 */
function declaredNames(decl) {
    const names = [];
    let depth = 0, quote = null, token = '';
    const flush = () => {
        const name = token.trim().split(/\s*=\s*/)[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
        token = '';
    };
    for (let i = 0; i < decl.length; i++) {
        const ch = decl[i];
        if (quote) {
            if (ch === quote && decl[i - 1] !== '\\') quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
        if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
        if (ch === ',' && depth === 0) { flush(); continue; }
        token += ch;
    }
    flush();
    return names;
}

/** 星号导出来源 */
function starSources(source) {
    const out = [];
    for (const m of source.matchAll(exportFromRe)) {
        if (!m[1]) out.push(m[2]);
    }
    return out;
}

const sourceCache = new Map();
function sourceOf(file) {
    if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(file, 'utf8'));
    return sourceCache.get(file);
}

const errors = [];
const exportCache = new Map();

/** 完整导出集合（含 export * from 传递） */
function fullExports(file, seen = new Set()) {
    if (exportCache.has(file)) return exportCache.get(file);
    if (seen.has(file)) return new Set(); // 循环保护
    seen.add(file);
    const src = sourceOf(file);
    const names = ownExports(src);
    for (const spec of starSources(src)) {
        const target = resolveSpecifier(file, spec);
        if (!target) continue;
        if (!existsSync(target)) {
            errors.push(`${relative(ROOT, file)}: export * from '${spec}' 无法解析`);
            continue;
        }
        for (const n of fullExports(target, seen)) names.add(n);
    }
    if (!seen.size || seen.size === 1) exportCache.set(file, names);
    seen.delete(file);
    return names;
}

let checkedImports = 0;

for (const file of files) {
    const src = sourceOf(file);
    const rel = relative(ROOT, file);

    for (const m of src.matchAll(importRe)) {
        const named = m[2];
        const spec = m[5];
        const target = resolveSpecifier(file, spec);
        if (!target) continue;
        if (!existsSync(target)) {
            errors.push(`${rel}: 导入 '${spec}' 不存在`);
            continue;
        }
        if (named) {
            const exports = fullExports(target);
            for (const part of named.slice(1, -1).split(',')) {
                const piece = part.trim();
                if (!piece) continue;
                const importedName = piece.split(/\s+as\s+/)[0].trim();
                checkedImports++;
                if (!exports.has(importedName)) {
                    errors.push(`${rel}: '${spec}' 未导出 '${importedName}'`);
                }
            }
        }
    }
    for (const m of src.matchAll(sideEffectRe)) {
        const target = resolveSpecifier(file, m[1]);
        if (target && !existsSync(target)) errors.push(`${rel}: 导入 '${m[1]}' 不存在`);
    }
    for (const m of src.matchAll(exportFromRe)) {
        const target = resolveSpecifier(file, m[2]);
        if (target && !existsSync(target)) errors.push(`${rel}: re-export '${m[2]}' 不存在`);
    }
}

console.log(`已校验 ${files.length} 个模块、${checkedImports} 条具名导入`);
if (errors.length) {
    console.error(`\n发现 ${errors.length} 处问题：`);
    errors.forEach(e => console.error(' - ' + e));
    process.exit(1);
}
console.log('导入/导出关系校验通过 ✓');