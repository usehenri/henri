/**
 * The boot graph
 *
 * henri used to boot like SysV init: eight fixed run levels, everything on a
 * level starting together, the next level waiting for the whole of the
 * previous one. Modules now say where they go by name and the loader
 * computes the order, the way systemd orders units:
 *
 *   needs     the modules it cannot work without. They must be registered
 *             and they finish before it starts.
 *   after     ordering only: those of them that are registered finish first.
 *   before    ordering only: those of them that are registered start after.
 *   runlevel  the numeric pin, unchanged from the run levels: a module that
 *             names nothing lands after every module of a lower level and
 *             before every module of a higher one.
 *
 * Naming replaces the number: what a module says about itself is the whole
 * truth about where it goes, so two modules that said nothing about each
 * other start together. The number keeps working on its own (an application
 * module that just wants a slot sets `runlevel` and stops there) and it stays
 * the module's slot in every case, since that is what a numeric pin and the
 * boot ceiling (`new Henri({ runlevel })`) are measured against.
 *
 * @module base/graph
 */

const { fail } = require('./errors');

/** The lowest slot a module can pin itself to */
const MIN_RUNLEVEL = 0;

/** The highest slot, and the level a normal boot goes to */
const MAX_RUNLEVEL = 6;

/** What a level is for, printed by the diagnostics and `henri analyze` */
const LEVELS = [
  'configuration',
  'services the application layer talks to',
  'the application layer and the express app',
  'models and views',
  'users, sessions and the job queue',
  'routes and workers',
  'application modules',
];

/**
 * The names a declaration holds
 * A single name is accepted where an array is expected.
 *
 * @param {any} value the declared value
 * @returns {Array<string>} the names, empty when nothing was declared
 */
function toNames(value) {
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((name) => typeof name === 'string' && name.length > 0);
}

/**
 * Names close enough to a mistyped one to be worth suggesting
 *
 * @param {string} name the name nobody provides
 * @param {Array<string>} known the registered names
 * @returns {Array<string>} the candidates, closest first
 */
function suggest(name, known) {
  const target = name.toLowerCase();

  return known
    .filter((other) => {
      const candidate = other.toLowerCase();

      return (
        candidate.includes(target) ||
        target.includes(candidate) ||
        candidate.slice(0, 3) === target.slice(0, 3)
      );
    })
    .slice(0, 3);
}

/**
 * The modules of each level, lowest first
 *
 * @param {Array<object>} nodes the nodes of the plan
 * @returns {Array<object>} `{ level, purpose, modules }`, one per level
 */
function chartOf(nodes) {
  return LEVELS.map((purpose, level) => ({
    level,
    modules: nodes
      .filter((node) => node.runlevel === level)
      .map((node) => node.name),
    purpose,
  }));
}

/**
 * An error the boot graph refuses to build
 *
 * @param {string} message what is wrong
 * @param {Array<string>} modules the modules it is about
 * @param {string} code the henri error code of this failure
 * @returns {Error} the error, with `modules`, `module` and `code` set
 */
function graphError(message, modules, code) {
  const error = fail(code, `modules => ${message}`);

  error.module = 'modules';
  error.modules = modules;

  return error;
}

/**
 * Build the boot plan of the registered modules
 *
 * Nothing starts before this returns: a name nobody provides and a circular
 * dependency both throw here, naming the modules involved.
 *
 * @param {Array<object>} modules the modules, in registration order
 * @param {object} [options={}] options
 * @param {number} [options.ceiling=MAX_RUNLEVEL] the level the boot stops at
 * @throws {Error} when a dependency is missing or the graph has a cycle
 * @returns {object} the plan: `nodes`, `order`, `skipped` and `chart`
 */
function build(modules, { ceiling = MAX_RUNLEVEL } = {}) {
  const stop = Number.isInteger(ceiling) ? ceiling : MAX_RUNLEVEL;
  const kept = [];
  const skipped = [];

  for (const [index, mod] of modules.entries()) {
    if (mod.runlevel > stop) {
      skipped.push({ name: mod.name, runlevel: mod.runlevel });

      continue;
    }

    const after = toNames(mod.after);
    const before = toNames(mod.before);
    const needs = toNames(mod.needs);

    kept.push({
      after,
      before,
      blocks: new Set(),
      index,
      module: mod,
      name: mod.name,
      needs,
      pin:
        needs.length + after.length + before.length > 0 ? 'name' : 'runlevel',
      runlevel: mod.runlevel,
      waitsOn: new Set(),
      why: new Map(),
    });
  }

  const nodes = new Map(kept.map((node) => [node.name, node]));

  link(kept, nodes, skipped, stop);

  return {
    ceiling: stop,
    chart: chartOf(kept),
    nodes,
    order: linearize(kept, nodes),
    skipped,
  };
}

/**
 * Draw the edges of the graph, from the declarations and the numeric pins
 *
 * @param {Array<object>} kept the nodes taking part in the boot
 * @param {Map<string, object>} nodes the same, by name
 * @param {Array<object>} skipped the modules the ceiling left out
 * @param {number} ceiling the level the boot stops at
 * @throws {Error} when a `needs` names a module nobody provides
 * @returns {Map<string, object>} the nodes, now linked
 */
function link(kept, nodes, skipped, ceiling) {
  // With their level: the answer to "what could I have named, and where
  // does each of them sit?"
  const loaded = kept.map((node) => `${node.name} (${node.runlevel})`);
  const cut = new Map(skipped.map((entry) => [entry.name, entry.runlevel]));

  /**
   * `from` finishes before `to` starts
   *
   * @param {string} from the module that goes first
   * @param {string} to the module that waits
   * @param {string} why what put the edge there
   * @returns {void}
   */
  const edge = (from, to, why) => {
    nodes.get(to).waitsOn.add(from);
    nodes.get(from).blocks.add(to);

    if (!nodes.get(to).why.has(from)) {
      nodes.get(to).why.set(from, why);
    }
  };

  // What a module named about itself first, so the graph explains an edge
  // with the declaration that asked for it rather than a numeric pin
  for (const node of kept) {
    for (const name of node.needs) {
      if (!nodes.has(name)) {
        throw missingDependency(node, name, { ceiling, cut, loaded });
      }

      edge(name, node.name, 'needs');
    }

    for (const name of node.after) {
      nodes.has(name) && edge(name, node.name, 'after');
    }

    for (const name of node.before) {
      nodes.has(name) && edge(node.name, name, 'before');
    }
  }

  // Then the numeric pins: a module that named nothing sits between the
  // levels below it and the levels above, which is what a run level was
  for (const node of kept.filter((entry) => entry.pin === 'runlevel')) {
    for (const other of kept) {
      if (other.runlevel < node.runlevel) {
        edge(other.name, node.name, `runlevel ${node.runlevel}`);
      } else if (other.runlevel > node.runlevel) {
        edge(node.name, other.name, `runlevel ${node.runlevel}`);
      }
    }
  }

  return nodes;
}

/**
 * The error of a `needs` nobody answers
 *
 * @param {object} node the module that needs it
 * @param {string} name the name it needs
 * @param {object} context where the boot stands
 * @param {number} context.ceiling the level the boot stops at
 * @param {Map<string, number>} context.cut the modules the ceiling left out
 * @param {Array<string>} context.loaded the registered names
 * @returns {Error} the error to throw
 */
function missingDependency(node, name, { ceiling, cut, loaded }) {
  if (cut.has(name)) {
    return graphError(
      `"${node.name}" needs "${name}", which this boot leaves out: ` +
        `"${name}" sits at level ${cut.get(name)} and the boot stops at ` +
        `level ${ceiling}.
  Lower the runlevel of "${name}" to ${ceiling} or below, or run the command that boots the whole application (\`henri server\`).
  \`henri analyze\` prints the level of every module.`,
      [node.name, name],
      'HENRI_BOOT_DEPENDENCY_ABOVE_CEILING'
    );
  }

  const close = suggest(
    name,
    loaded.map((entry) => entry.split(' ')[0])
  );

  const hint = close.length > 0 ? `\n  Did you mean: ${close.join(', ')}?` : '';

  return graphError(
    `"${node.name}" needs "${name}", which no module provides.
  Loaded modules: ${loaded.join(', ')}${hint}
  Register the module that provides "${name}" -- install the package that ships it, or add it to config/modules.js -- or fix the name in the \`needs\` of "${node.name}".`,
    [node.name, name],
    'HENRI_BOOT_MISSING_DEPENDENCY'
  );
}

/**
 * A deterministic order of the graph, the way the boot walks it
 * Everything that can start at once comes first, in registration order,
 * then what they unblock: the same shape the run levels had, computed
 * instead of declared. It is also the order shutdown reverses.
 *
 * @param {Array<object>} kept the nodes, in registration order
 * @param {Map<string, object>} nodes the same, by name
 * @throws {Error} when the graph has a cycle
 * @returns {Array<string>} the names, in order
 */
function linearize(kept, nodes) {
  const left = new Map(kept.map((node) => [node.name, node.waitsOn.size]));
  const order = [];

  while (order.length < kept.length) {
    const wave = kept.filter((node) => left.get(node.name) === 0);

    if (wave.length < 1) {
      throw cycleError(kept, left, nodes);
    }

    for (const node of wave) {
      order.push(node.name);
      left.delete(node.name);
    }

    for (const node of wave) {
      for (const name of node.blocks) {
        left.has(name) && left.set(name, left.get(name) - 1);
      }
    }
  }

  return order;
}

/**
 * The error of a graph that eats its own tail
 *
 * @param {Array<object>} kept the nodes, in registration order
 * @param {Map<string, number>} left what is left to sort
 * @param {Map<string, object>} nodes the nodes, by name
 * @returns {Error} the error to throw, naming the modules of the cycle
 */
function cycleError(kept, left, nodes) {
  const stuck = kept.filter((node) => left.has(node.name));
  const cycle = findCycle(stuck, left);
  const path = [...cycle, cycle[0]];
  const why = [];

  for (let step = 1; step < path.length; step++) {
    const node = nodes.get(path[step]);

    why.push(
      `  "${path[step]}" waits on "${path[step - 1]}" (${node.why.get(path[step - 1])})`
    );
  }

  return graphError(
    `circular dependency: ${path.join(' -> ')}\n${why.join('\n')}
  Drop one of those declarations, or replace a \`needs\` that is only about ordering with an \`after\`.`,
    cycle,
    'HENRI_BOOT_CIRCULAR_DEPENDENCY'
  );
}

/**
 * Walk the leftovers until a name comes back
 *
 * @param {Array<object>} stuck the nodes that could not be sorted
 * @param {Map<string, number>} left the same, by name
 * @returns {Array<string>} the names of one cycle, in order
 */
function findCycle(stuck, left) {
  const [start] = stuck;
  const seen = [];
  let current = start.name;

  while (!seen.includes(current)) {
    seen.push(current);

    const node = stuck.find((entry) => entry.name === current);

    current = [...node.waitsOn].find((name) => left.has(name));
  }

  return seen.slice(seen.indexOf(current)).reverse();
}

module.exports = { LEVELS, MAX_RUNLEVEL, MIN_RUNLEVEL, build };
