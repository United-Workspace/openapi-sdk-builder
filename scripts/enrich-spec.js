#!/usr/bin/env node

/**
 * Universal OpenAPI Specification Cleaner & Enricher
 * Part of @united-workspace/openapi-sdk-builder
 *
 * Capabilities:
 * - Strips redundant 'type: object' when '$ref' is present (prevents inline/anonymous models)
 * - Flattens single-child same-name wrapper properties (e.g. user.properties.user -> user)
 * - Idempotently applies enum additions (set union with upstream detection)
 * - Configures discriminator mappings & child extensions across Swagger 2.0 and OpenAPI 3.x
 * - Zero external npm dependencies (pure standard Node.js)
 */

const fs = require('fs');
const path = require('path');

// 1. Parse CLI Arguments
const args = process.argv.slice(2);
let specPath = null;
let enrichmentsPath = null;
let outputPath = null;

for (const arg of args) {
  if (arg.startsWith('--spec=')) specPath = arg.substring(7);
  else if (arg.startsWith('--enrichments=')) enrichmentsPath = arg.substring(14);
  else if (arg.startsWith('--output=')) outputPath = arg.substring(9);
  else if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node enrich-spec.js [options]
Options:
  --spec=<path>         Path to input Swagger/OpenAPI JSON
  --enrichments=<path>  Path to enrichments JSON
  --output=<path>       Path to output enriched JSON (default: overwrites spec)
`);
    process.exit(0);
  }
}

if (!specPath) {
  console.error('[ERROR] --spec=<path> argument is required.');
  process.exit(1);
}

if (!outputPath) {
  outputPath = specPath;
}

if (!fs.existsSync(specPath)) {
  console.error(`[ERROR] Spec file not found at: ${specPath}`);
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
} catch (err) {
  console.error(`[ERROR] Failed to parse specification JSON: ${err.message}`);
  process.exit(1);
}

console.log('========================================');
console.log('   Universal OpenAPI Spec Normalization ');
console.log('========================================');

// 2. Universal Cleanups
let removedTypes = 0;
let flattenedWrappers = 0;

function cleanSpecRecursively(node) {
  if (!node || typeof node !== 'object') return;

  // Clean redundant type alongside $ref
  if (node.$ref && node.type) {
    delete node.type;
    removedTypes++;
  }

  // Flatten single-property wrappers with identical name (e.g. user.properties.user)
  if (node.properties && typeof node.properties === 'object') {
    for (const [k, child] of Object.entries(node.properties)) {
      if (child && typeof child === 'object' && child.properties && typeof child.properties === 'object') {
        const keys = Object.keys(child.properties);
        if (keys.length === 1 && keys[0] === k) {
          node.properties[k] = child.properties[k];
          flattenedWrappers++;
        }
      }
    }
  }

  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') {
      cleanSpecRecursively(val);
    }
  }
}

cleanSpecRecursively(spec);

if (removedTypes > 0) {
  console.log(`[CLEANUP] Stripped ${removedTypes} redundant 'type' declarations alongside '$ref'.`);
}
if (flattenedWrappers > 0) {
  console.log(`[CLEANUP] Flattened ${flattenedWrappers} redundant same-name wrapper property definitions.`);
}

// 3. Declarative Enrichments
let enrichments = {};
if (enrichmentsPath && fs.existsSync(enrichmentsPath)) {
  try {
    enrichments = JSON.parse(fs.readFileSync(enrichmentsPath, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] Failed to parse enrichments JSON: ${err.message}`);
    process.exit(1);
  }
}

const isSwagger2 = !!spec.swagger;
const schemaPrefix = isSwagger2 ? '#/definitions/' : '#/components/schemas/';

function getSchema(model) {
  if (isSwagger2) {
    return spec.definitions?.[model];
  }
  return spec.components?.schemas?.[model];
}

// 3a. Enum Additions (Idempotent Set Union)
if (enrichments.enumAdditions && typeof enrichments.enumAdditions === 'object') {
  for (const [modelName, properties] of Object.entries(enrichments.enumAdditions)) {
    const schema = getSchema(modelName);
    if (!schema) {
      console.log(`[WARNING] Model '${modelName}' not found in specification definitions.`);
      continue;
    }

    for (const [propName, additions] of Object.entries(properties)) {
      if (!schema.properties?.[propName]) {
        console.log(`[WARNING] Property '${propName}' not found on model '${modelName}'.`);
        continue;
      }

      const propSchema = schema.properties[propName];
      const existing = propSchema.enum || [];

      const alreadyPresent = additions.filter(val => existing.includes(val));
      const newAdditions = additions.filter(val => !existing.includes(val));

      for (const val of alreadyPresent) {
        console.log(`[INFO] Enum '${val}' on '${modelName}.${propName}' is already present upstream. (Deduplicated)`);
      }
      for (const val of newAdditions) {
        console.log(`[APPLIED] Added missing enum '${val}' to '${modelName}.${propName}'.`);
      }

      propSchema.enum = Array.from(new Set([...existing, ...additions]));
    }
  }
}

// 3b. Discriminator Mappings & Child Extensions
if (enrichments.discriminatorMappings && typeof enrichments.discriminatorMappings === 'object') {
  for (const [parentModel, mappingConfig] of Object.entries(enrichments.discriminatorMappings)) {
    const parentSchema = getSchema(parentModel);
    if (!parentSchema) {
      console.log(`[WARNING] Parent model '${parentModel}' not found in specification definitions.`);
      continue;
    }

    const propName = mappingConfig.property || 'type';
    const mapping = mappingConfig.mapping || {};

    if (isSwagger2) {
      parentSchema.discriminator = propName;
    } else {
      const mappingDict = {};
      for (const [discVal, childModel] of Object.entries(mapping)) {
        mappingDict[discVal] = `${schemaPrefix}${childModel}`;
      }
      parentSchema.discriminator = {
        propertyName: propName,
        mapping: mappingDict,
      };
    }

    for (const [discVal, childModel] of Object.entries(mapping)) {
      const childSchema = getSchema(childModel);
      if (childSchema) {
        childSchema['x-discriminator-value'] = discVal;
        childSchema['x-discriminator-field'] = propName;
      } else {
        console.log(`[WARNING] Child model '${childModel}' referenced in mapping not found.`);
      }
    }

    console.log(`[APPLIED] Configured discriminator for parent model '${parentModel}' (property: '${propName}', ${Object.keys(mapping).length} mapped subclasses).`);
  }
}

// 4. Output Result
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n');
console.log('========================================');
console.log(` Enriched specification written to: ${outputPath}`);
console.log('========================================');
