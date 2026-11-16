/**
 * Dynamic control blocks for scratch-gui.
 *
 * Turns control_if into a dynamic "if / else if ... / else" block (the opcode
 * stays control_if so existing projects keep working) and adds a new
 * control_switch block. Branches and cases are added and removed with
 * clickable arrow and × fields, never with dropdown menus.
 */

import BlockType from 'scratch-vm/src/extension-support/block-type';
import Cast from 'scratch-vm/src/util/cast';
import {ScriptTreeGenerator} from 'scratch-vm/src/compiler/irgen';
import {createCheckboxShadowDom} from './checkbox-blocks';

const BUTTON_SIZE = 20;

/** Click handlers for the arrow and × buttons, keyed by action name. */
const actions = {};

let ScratchBlocks = null;
let vmRef = null;
let patched = false;
let ShapeButtonField = null;

/**
 * Read the branch layout of an if block.
 * @param {!Blockly.Block} block the block to inspect
 * @return {object} Branch state with itemCount and isElse.
 */
const readIfState = block => {
    let itemCount = 1;
    for (const input of block.inputList) {
        let branch = 0;
        const conditionMatch = /^ELSE_BRANCH_CONDITION_(\d+)$/.exec(input.name);
        const elseMatch = /^ELSE_BRANCH_DUMMY_(\d+)$/.exec(input.name);
        const thenMatch = /^THEN_DUMMY_(\d+)$/.exec(input.name);
        const stackMatch = /^SUBSTACK(\d+)$/.exec(input.name);
        if (conditionMatch) branch = Number(conditionMatch[1]);
        if (elseMatch) branch = Number(elseMatch[1]);
        if (thenMatch) branch = Number(thenMatch[1]);
        if (stackMatch) branch = Number(stackMatch[1]);
        if (branch > itemCount) itemCount = branch;
    }
    return {
        itemCount,
        isElse: !!block.getInput(`ELSE_BRANCH_DUMMY_${itemCount}`)
    };
};

/**
 * Read the case layout of a switch block.
 * @param {!Blockly.Block} block the block to inspect
 * @return {object} Case state with caseCount, maxJs and hasDefault.
 */
const readSwitchState = block => {
    let lastBranch = 1;
    const maxJs = {};
    for (const input of block.inputList) {
        const valueMatch = /^CASE_(\d+)_(\d+)$/.exec(input.name);
        if (valueMatch) {
            const index = Number(valueMatch[1]);
            const valueIndex = Number(valueMatch[2]);
            if (index > lastBranch) lastBranch = index;
            if (!maxJs[index] || valueIndex > maxJs[index]) maxJs[index] = valueIndex;
        }
        const arrowMatch = /^CASE_DUMMY_(\d+)$/.exec(input.name);
        if (arrowMatch && Number(arrowMatch[1]) > lastBranch) lastBranch = Number(arrowMatch[1]);
        const defaultMatch = /^CASE_BRANCH_DUMMY_(\d+)$/.exec(input.name);
        if (defaultMatch && Number(defaultMatch[1]) > lastBranch) lastBranch = Number(defaultMatch[1]);
        const stackMatch = /^SUBSTACK(\d+)$/.exec(input.name);
        if (stackMatch && Number(stackMatch[1]) > lastBranch) lastBranch = Number(stackMatch[1]);
    }
    const hasDefault = !!block.getInput(`CASE_BRANCH_DUMMY_${lastBranch}`);
    const caseCount = hasDefault ? lastBranch - 1 : lastBranch;
    for (let i = 1; i <= caseCount; i++) {
        if (!maxJs[i]) maxJs[i] = 1;
    }
    return {
        caseCount,
        maxJs,
        hasDefault
    };
};

/**
 * Serialize a block's mutation to XML text.
 * @param {!Blockly.Block} block the block
 * @return {string} mutation XML text, or '' when the block has no mutation
 */
const mutationText = block => {
    if (typeof block.mutationToDom !== 'function') return '';
    const mutation = block.mutationToDom();
    return mutation ? ScratchBlocks.Xml.domToText(mutation) : '';
};

/**
 * Run a function that reshapes a block, then fire one mutation change event.
 * @param {!Blockly.Block} block the block being mutated
 * @param {function} fn function that reshapes the block
 */
const withMutationChange = (block, fn) => {
    const previousGroup = ScratchBlocks.Events.getGroup();
    if (!previousGroup) ScratchBlocks.Events.setGroup(true);
    const before = mutationText(block);
    try {
        fn();
        const after = mutationText(block);
        if (after !== before) {
            ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                block, 'mutation', null, before, after
            ));
        }
    } finally {
        if (!previousGroup) ScratchBlocks.Events.setGroup(false);
    }
};

/**
 * Define the clickable SVG image field used for the add/remove buttons.
 */
const defineButtonField = () => {
    const ShapeButtonFieldCtor = function (src, width, height, alt, flipRtl, tooltip, onClick) {
        ShapeButtonFieldCtor.superClass_.constructor.call(this, src, width, height, alt, flipRtl);
        this.tooltip_ = tooltip;
        this.onClick_ = onClick;
    };
    ScratchBlocks.goog.inherits(ShapeButtonFieldCtor, ScratchBlocks.FieldImage);

    ShapeButtonFieldCtor.prototype.EDITABLE = true;
    ShapeButtonFieldCtor.prototype.SERIALIZABLE = false;
    ShapeButtonFieldCtor.prototype.CURSOR = 'pointer';

    ShapeButtonFieldCtor.prototype.init = function () {
        if (this.fieldGroup_) return;
        ShapeButtonFieldCtor.superClass_.init.call(this);
        if (!this.fieldGroup_) return;
        this.fieldGroup_.style.cursor = 'pointer';
        this.setTooltip(this.tooltip_);
        this.mouseDownWrapper_ = ScratchBlocks.bindEventWithChecks_(
            this.fieldGroup_, 'mousedown', this, this.onMouseDown_
        );
    };

    ShapeButtonFieldCtor.prototype.dispose = function () {
        if (this.mouseDownWrapper_) {
            ScratchBlocks.unbindEvent_(this.mouseDownWrapper_);
            this.mouseDownWrapper_ = null;
        }
        ShapeButtonFieldCtor.superClass_.dispose.call(this);
    };

    ShapeButtonFieldCtor.prototype.showEditor_ = function () {
        this.onClick_();
    };

    ShapeButtonField = ShapeButtonFieldCtor;
};

/**
 * Name of the substack input for a branch number.
 * @param {number} branchNum 1-based branch number
 * @return {string} input name
 */
const substackName = branchNum => (branchNum === 1 ? 'SUBSTACK' : `SUBSTACK${branchNum}`);

/**
 * Build the arrow buttons shown on a switch case row.
 * @param {number} index 1-based case index
 * @param {number} maxJ number of comparison values in the case
 * @return {!Array.<object>} button specs
 */
const caseButtons = (index, maxJ) => {
    const buttons = [];
    if (maxJ > 1) {
        buttons.push({
            icon: 'left',
            action: 'removeCaseValue',
            args: [index],
            tooltip: 'Remove or'
        });
    }
    buttons.push({
        icon: 'right',
        action: 'addCaseValue',
        args: [index],
        tooltip: 'Add or'
    });
    return buttons;
};

/**
 * Build the ordered input list for an if block.
 * @param {object} target desired branch layout (itemCount, isElse)
 * @return {!Array.<object>} input specs, in order
 */
const buildIfSpecs = target => {
    const specs = [{
        name: 'CONDITION',
        type: 'value',
        check: 'Boolean',
        label: 'if'
    }, {
        name: 'THEN_DUMMY_1',
        type: 'dummy',
        label: 'then'
    }, {
        name: 'SUBSTACK',
        type: 'statement'
    }];
    for (let branch = 2; branch <= target.itemCount; branch++) {
        if (target.isElse && branch === target.itemCount) {
            specs.push({
                name: `ELSE_BRANCH_DUMMY_${branch}`,
                type: 'dummy',
                label: 'else'
            });
        } else {
            specs.push({
                name: `ELSE_BRANCH_CONDITION_${branch}`,
                type: 'value',
                check: 'Boolean',
                label: 'else if'
            });
            specs.push({
                name: `THEN_DUMMY_${branch}`,
                type: 'dummy',
                label: 'then'
            });
        }
        specs.push({
            name: substackName(branch),
            type: 'statement'
        });
    }
    const buttons = [];
    if (target.itemCount > 1) {
        buttons.push({
            icon: 'up',
            action: 'removeIfBranch',
            args: [],
            tooltip: 'Remove branch'
        });
    }
    buttons.push({
        icon: 'bottom',
        action: 'addIfBranch',
        args: [],
        tooltip: 'Add branch'
    });
    specs.push({
        name: 'BUTTONS',
        type: 'dummy',
        align: ScratchBlocks.ALIGN_RIGHT,
        buttons
    });
    return specs;
};

/**
 * Build the ordered input list for a switch block.
 * @param {object} target desired case layout (caseCount, maxJs, hasDefault)
 * @return {!Array.<object>} input specs, in order
 */
const buildSwitchSpecs = target => {
    const specs = [{
        name: 'SWITCH',
        type: 'value',
        label: 'switch'
    }];
    for (let index = 1; index <= target.caseCount; index++) {
        const maxJ = target.maxJs[index] || 1;
        for (let valueIndex = 1; valueIndex <= maxJ; valueIndex++) {
            specs.push({
                name: `CASE_${index}_${valueIndex}`,
                type: 'value',
                label: valueIndex === 1 ? 'case' : 'or'
            });
        }
        specs.push({
            name: `CASE_DUMMY_${index}`,
            type: 'dummy',
            align: ScratchBlocks.ALIGN_RIGHT,
            buttons: caseButtons(index, maxJ)
        });
        specs.push({
            name: substackName(index),
            type: 'statement'
        });
    }
    if (target.hasDefault) {
        const defaultBranch = target.caseCount + 1;
        specs.push({
            name: `CASE_BRANCH_DUMMY_${defaultBranch}`,
            type: 'dummy',
            label: 'default'
        });
        specs.push({
            name: substackName(defaultBranch),
            type: 'statement'
        });
    }
    const buttons = [];
    if (target.caseCount > 1 || target.hasDefault) {
        buttons.push({
            icon: 'up',
            action: 'removeSwitchBranch',
            args: [],
            tooltip: 'Remove branch'
        });
    }
    buttons.push({
        icon: 'bottom',
        action: 'addSwitchBranch',
        args: [],
        tooltip: 'Add branch'
    });
    specs.push({
        name: 'BUTTONS',
        type: 'dummy',
        align: ScratchBlocks.ALIGN_RIGHT,
        buttons
    });
    return specs;
};

/**
 * Resolve the image for a button icon.
 * @param {!Blockly.Workspace} workspace the block workspace
 * @param {string} icon icon name
 * @return {string} image URL
 */
const buttonSrc = (workspace, icon) => {
    if (icon === 'delete') return `${workspace.options.pathToMedia}delete-x.svg`;
    return `assets/${icon}.svg`;
};

/**
 * Create a clickable button field.
 * @param {!Blockly.Block} block the block that owns the field
 * @param {object} spec button spec
 * @return {!Blockly.Field} the new field
 */
const createButtonField = (block, spec) => new ShapeButtonField(
    buttonSrc(block.workspace, spec.icon),
    BUTTON_SIZE,
    BUTTON_SIZE,
    spec.tooltip,
    true,
    spec.tooltip,
    () => {
        const action = actions[spec.action];
        if (action) action(block, ...spec.args);
    }
);

/**
 * Append one input described by a spec.
 * @param {!Blockly.Block} block the block being reshaped
 * @param {object} spec input spec
 */
const createInput = (block, spec) => {
    let input;
    if (spec.type === 'value') {
        input = block.appendValueInput(spec.name);
        if (spec.check) input.setCheck(spec.check);
    } else if (spec.type === 'statement') {
        input = block.appendStatementInput(spec.name);
    } else {
        input = block.appendDummyInput(spec.name);
    }
    if (spec.align) input.setAlign(spec.align);
    if (spec.label) input.appendField(spec.label);
    if (spec.buttons) {
        for (const button of spec.buttons) input.appendField(createButtonField(block, button));
    }
    if (block.rendered) input.initOutlinePath(block.getSvgRoot());
};

/**
 * Build the XML for an empty text shadow.
 * @return {!Element} shadow XML element
 */
const createTextShadowDom = () => {
    const shadow = document.createElement('shadow');
    shadow.setAttribute('type', 'text');
    const field = document.createElement('field');
    field.setAttribute('name', 'TEXT');
    shadow.appendChild(field);
    return shadow;
};

/**
 * Attach default shadows to empty value inputs.
 * @param {!Blockly.Block} block the block to inspect
 */
const materializeShadowList = block => {
    const workspace = block.workspace;
    if (!workspace) return;
    for (const input of block.inputList) {
        const connection = input.connection;
        if (!connection || input.type !== ScratchBlocks.INPUT_VALUE) continue;
        if (connection.targetBlock()) continue;
        if (connection.getShadowDom()) continue;
        const isBoolean = connection.check_ && connection.check_.indexOf('Boolean') !== -1;
        const shadowDom = isBoolean ? createCheckboxShadowDom() : createTextShadowDom();
        connection.setShadowDom(shadowDom);
        const shadowBlock = ScratchBlocks.Xml.domToBlock(shadowDom, workspace);
        if (shadowBlock && shadowBlock.outputConnection && !connection.targetBlock()) {
            connection.connect(shadowBlock.outputConnection);
        }
    }
};

/**
 * Attach shadows to empty value inputs without breaking event grouping.
 * @param {!Blockly.Block} block the block to inspect
 */
const materializeShadows = block => {
    if (!ScratchBlocks.Events.isEnabled()) {
        materializeShadowList(block);
        return;
    }
    const group = ScratchBlocks.Events.getGroup();
    setTimeout(() => {
        const previous = ScratchBlocks.Events.getGroup();
        ScratchBlocks.Events.setGroup(group);
        materializeShadowList(block);
        ScratchBlocks.Events.setGroup(previous);
    }, 0);
};

/**
 * Push the workspace's current input layout for a block into the VM.
 * @param {VirtualMachine} vm the scratch vm
 * @param {!Blockly.Block} block the reshaped block
 */
const syncVmInputs = (vm, block) => {
    const target = vm && vm.editingTarget;
    if (!target || !target.blocks || !block.workspace) return;
    const container = target.blocks;
    const records = container._blocks;
    if (!records || !records[block.id]) return;

    const record = records[block.id];
    if (!record.inputs) record.inputs = {};
    const newInputs = {};
    const newIds = {};

    for (const input of block.inputList) {
        if (input.type === ScratchBlocks.DUMMY_INPUT) continue;
        const connection = input.connection;
        if (!connection) continue;
        const child = connection.targetBlock();
        const shadowDom = connection.getShadowDom();
        const blockId = child ? child.id : null;
        let shadowId = null;
        if (child && child.isShadow()) {
            shadowId = child.id;
        } else if (shadowDom) {
            shadowId = shadowDom.getAttribute('id');
        }
        if (shadowId && !Object.prototype.hasOwnProperty.call(records, shadowId)) {
            shadowId = null;
        }
        if (!blockId && !shadowId) continue;
        newInputs[input.name] = {
            name: input.name,
            block: blockId,
            shadow: shadowId
        };
        if (blockId) newIds[blockId] = true;
        if (shadowId) newIds[shadowId] = true;
    }

    const oldIds = {};
    for (const name of Object.keys(record.inputs)) {
        const entry = record.inputs[name];
        if (entry.block) oldIds[entry.block] = true;
        if (entry.shadow) oldIds[entry.shadow] = true;
    }

    for (const id of Object.keys(newIds)) {
        const blockRecord = records[id];
        if (blockRecord && blockRecord.topLevel) container._deleteScript(id);
    }
    for (const id of Object.keys(oldIds)) {
        if (newIds[id]) continue;
        if (block.workspace.getBlockById(id)) continue;
        container.deleteBlock(id);
    }

    record.inputs = newInputs;
    container.resetCache();
};

/**
 * Push the block's inputs into the VM after the change events have fired.
 * @param {!Blockly.Block} block the reshaped block
 */
const scheduleSync = block => {
    setTimeout(() => setTimeout(() => syncVmInputs(vmRef, block), 0), 0);
};

/**
 * Reshape a block to match an ordered list of input specs.
 * @param {!Blockly.Block} block the block being reshaped
 * @param {!Array.<object>} specs input specs, in order
 */
const applyShape = (block, specs) => {
    const nameSet = {};
    const rebuildSet = {};
    for (const spec of specs) {
        nameSet[spec.name] = true;
        if (spec.buttons) rebuildSet[spec.name] = true;
    }

    // Remove inputs that are not part of the new shape. Rows of buttons are
    // always rebuilt because their icons depend on the current branch state.
    const removals = [];
    for (const input of block.inputList) {
        if (!nameSet[input.name] || rebuildSet[input.name]) removals.push(input.name);
    }
    for (const name of removals) {
        const input = block.getInput(name);
        if (!input) continue;
        const connection = input.connection;
        const child = connection && connection.targetBlock();
        if (child && !child.isShadow()) {
            if (connection.getShadowDom()) connection.setShadowDom(null);
            child.dispose();
        }
        block.removeInput(name, true);
    }

    // Create the inputs that do not exist yet.
    for (const spec of specs) {
        if (block.getInput(spec.name)) continue;
        createInput(block, spec);
    }

    // Reorder the inputs to match the spec order, last to first.
    for (let i = specs.length - 2; i >= 0; i--) {
        block.moveInputBefore(specs[i].name, specs[i + 1].name);
    }

    materializeShadows(block);

    if (block.rendered) {
        block.render();
        block.bumpNeighbours_();
    }
};

/**
 * Reshape a block to match an ordered list of input specs and sync the VM.
 * @param {!Blockly.Block} block the block being reshaped
 * @param {!Array.<object>} specs input specs, in order
 */
const updateShape = (block, specs) => {
    withMutationChange(block, () => applyShape(block, specs));
    scheduleSync(block);
};

/**
 * Toggle the end of an if block between "else" and "else if", adding a branch
 * when the last item is a plain condition.
 * @param {!Blockly.Block} block the if block
 */
actions.addIfBranch = block => {
    const state = readIfState(block);
    if (state.isElse) {
        updateShape(block, buildIfSpecs({
            itemCount: state.itemCount,
            isElse: false
        }));
    } else {
        updateShape(block, buildIfSpecs({
            itemCount: state.itemCount + 1,
            isElse: true
        }));
    }
};

/**
 * Walk the end of an if block back one step: else -> else if -> removed.
 * @param {!Blockly.Block} block the if block
 */
actions.removeIfBranch = block => {
    const state = readIfState(block);
    if (state.itemCount <= 1) return;
    updateShape(block, buildIfSpecs({
        itemCount: state.isElse ? state.itemCount - 1 : state.itemCount,
        isElse: !state.isElse
    }));
};

/**
 * Toggle the end of a switch block between "default" and "case", adding a
 * branch when the last item is a case.
 * @param {!Blockly.Block} block the switch block
 */
actions.addSwitchBranch = block => {
    const state = readSwitchState(block);
    if (state.hasDefault) {
        const maxJs = {};
        for (let i = 1; i <= state.caseCount; i++) maxJs[i] = state.maxJs[i];
        maxJs[state.caseCount + 1] = 1;
        updateShape(block, buildSwitchSpecs({
            caseCount: state.caseCount + 1,
            maxJs,
            hasDefault: false
        }));
    } else {
        updateShape(block, buildSwitchSpecs({
            caseCount: state.caseCount,
            maxJs: state.maxJs,
            hasDefault: true
        }));
    }
};

/**
 * Walk the end of a switch block back one step: default -> case -> removed.
 * @param {!Blockly.Block} block the switch block
 */
actions.removeSwitchBranch = block => {
    const state = readSwitchState(block);
    if (state.caseCount <= 1 && !state.hasDefault) return;
    updateShape(block, buildSwitchSpecs({
        caseCount: state.hasDefault ? state.caseCount : state.caseCount - 1,
        maxJs: state.maxJs,
        hasDefault: !state.hasDefault
    }));
};

/**
 * Add one comparison value to a case.
 * @param {!Blockly.Block} block the switch block
 * @param {number} index 1-based case index
 */
actions.addCaseValue = (block, index) => {
    const state = readSwitchState(block);
    if (index < 1 || index > state.caseCount) return;
    const maxJs = {};
    for (let i = 1; i <= state.caseCount; i++) maxJs[i] = state.maxJs[i];
    maxJs[index] = (maxJs[index] || 0) + 1;
    updateShape(block, buildSwitchSpecs({
        caseCount: state.caseCount,
        maxJs,
        hasDefault: state.hasDefault
    }));
};

/**
 * Remove the last comparison value of a case.
 * @param {!Blockly.Block} block the switch block
 * @param {number} index 1-based case index
 */
actions.removeCaseValue = (block, index) => {
    const state = readSwitchState(block);
    if (index < 1 || index > state.caseCount) return;
    if ((state.maxJs[index] || 0) < 2) return;
    const maxJs = {};
    for (let i = 1; i <= state.caseCount; i++) maxJs[i] = state.maxJs[i];
    maxJs[index] = maxJs[index] - 1;
    updateShape(block, buildSwitchSpecs({
        caseCount: state.caseCount,
        maxJs,
        hasDefault: state.hasDefault
    }));
};

/** Mutation methods shared by the dynamic if block. */
const ifMutations = {
    /**
     * Read the mutation of an if block into XML.
     * @return {!Element} mutation XML element
     */
    mutationToDom: function () {
        const state = readIfState(this);
        const mutation = document.createElement('mutation');
        mutation.setAttribute('itemcount', String(state.itemCount));
        mutation.setAttribute('islastitemelse', String(state.isElse));
        return mutation;
    },
    /**
     * Reshape an if block from its mutation XML.
     * @param {!Element} xmlElement mutation XML element
     */
    domToMutation: function (xmlElement) {
        const isElse = xmlElement.getAttribute('islastitemelse') === 'true';
        const itemCount = Math.max(isElse ? 2 : 1,
            parseInt(xmlElement.getAttribute('itemcount'), 10) || 1);
        updateShape(this, buildIfSpecs({
            itemCount,
            isElse
        }));
    }
};

/** Mutation methods shared by the switch block. */
const switchMutations = {
    /**
     * Read the mutation of a switch block into XML.
     * @return {!Element} mutation XML element
     */
    mutationToDom: function () {
        const state = readSwitchState(this);
        const mutation = document.createElement('mutation');
        mutation.setAttribute('casecount', String(state.caseCount));
        mutation.setAttribute('hasdefault', String(state.hasDefault));
        let hasMultiple = false;
        const parts = [];
        for (let i = 1; i <= state.caseCount; i++) {
            const count = state.maxJs[i] || 1;
            if (count > 1) hasMultiple = true;
            parts.push(`${i}:${count}`);
        }
        if (hasMultiple) mutation.setAttribute('casevalues', parts.join(','));
        return mutation;
    },
    /**
     * Reshape a switch block from its mutation XML.
     * @param {!Element} xmlElement mutation XML element
     */
    domToMutation: function (xmlElement) {
        const caseCount = Math.max(1, parseInt(xmlElement.getAttribute('casecount'), 10) || 1);
        const hasDefault = xmlElement.getAttribute('hasdefault') === 'true';
        const maxJs = {};
        const encoded = xmlElement.getAttribute('casevalues');
        if (encoded) {
            for (const part of encoded.split(',')) {
                const fields = part.split(':');
                const index = parseInt(fields[0], 10);
                const count = parseInt(fields[1], 10) || 1;
                if (index >= 1 && index <= caseCount) maxJs[index] = count;
            }
        }
        for (let i = 1; i <= caseCount; i++) {
            if (!maxJs[i]) maxJs[i] = 1;
        }
        updateShape(this, buildSwitchSpecs({
            caseCount,
            maxJs,
            hasDefault
        }));
    }
};

/**
 * Patch the vanilla control_if definition.
 * @param {object} definition the block definition
 */
const patchIfBlock = definition => {
    const originalInit = definition.init;
    definition.init = function () {
        originalInit.call(this);
        applyShape(this, buildIfSpecs({
            itemCount: 1,
            isElse: false
        }));
    };
    definition.mutationToDom = ifMutations.mutationToDom;
    definition.domToMutation = ifMutations.domToMutation;
};

/**
 * Define the control_switch block.
 */
const defineSwitchBlock = () => {
    if (ScratchBlocks.Blocks.control_switch) return;
    ScratchBlocks.Blocks.control_switch = {
        init: function () {
            this.jsonInit({
                type: 'control_switch',
                message0: 'switch %1',
                args0: [{
                    type: 'input_value',
                    name: 'SWITCH'
                }],
                category: ScratchBlocks.Categories.control,
                extensions: ['colours_control', 'shape_statement']
            });
            applyShape(this, buildSwitchSpecs({
                caseCount: 1,
                maxJs: {1: 1},
                hasDefault: false
            }));
        },
        mutationToDom: switchMutations.mutationToDom,
        domToMutation: switchMutations.domToMutation
    };
};

/**
 * Check whether an if block has a non-trivial shape.
 * @param {object} block VM block record
 * @return {boolean} whether the if block is dynamic
 */
const isDynamicIf = block => {
    const mutation = block.mutation;
    if (mutation) {
        if (Number(mutation.itemcount) > 1) return true;
        if (mutation.islastitemelse === 'true') return true;
    }
    for (const name of Object.keys(block.inputs || {})) {
        if (name.indexOf('ELSE_BRANCH_CONDITION_') === 0 ||
            name.indexOf('ELSE_BRANCH_DUMMY_') === 0) return true;
    }
    return false;
};

/**
 * Teach the compiler how to run the dynamic control blocks.
 */
const patchCompiler = () => {
    if (ScriptTreeGenerator.prototype.twDynamicControlPatched) return;
    ScriptTreeGenerator.prototype.twDynamicControlPatched = true;

    const originalDescend = ScriptTreeGenerator.prototype.descendStackedBlock;
    ScriptTreeGenerator.prototype.descendStackedBlock = function (block) {
        if (block.opcode === 'control_switch' ||
            (block.opcode === 'control_if' && isDynamicIf(block))) {
            return this.descendCompatLayerStack(block);
        }
        return originalDescend.call(this, block);
    };

    const originalGetBlockInfo = ScriptTreeGenerator.prototype.getBlockInfo;
    ScriptTreeGenerator.prototype.getBlockInfo = function (fullOpcode) {
        if (fullOpcode === 'control_if' || fullOpcode === 'control_switch') {
            return {
                info: {
                    opcode: fullOpcode,
                    blockType: BlockType.CONDITIONAL
                }
            };
        }
        return originalGetBlockInfo.call(this, fullOpcode);
    };
};

/**
 * Read the mutation of the block that is currently executing.
 * @param {object} util block utility
 * @return {object|null} mutation attributes, or null when unavailable
 */
const currentMutation = util => {
    const thread = util.thread;
    const target = util.target || (thread && thread.target);
    const blockId = thread && thread.peekStack ? thread.peekStack() : null;
    const block = blockId && target && target.blocks ? target.blocks.getBlock(blockId) : null;
    return (block && block.mutation) || null;
};

/**
 * Pick the branch to run when no condition matched.
 * @param {object} args block arguments
 * @param {object} util block utility
 * @return {number} 1-based branch number
 */
const ifFallbackBranch = (args, util) => {
    const mutation = currentMutation(util);
    if (mutation) {
        const itemCount = Math.max(1, parseInt(mutation.itemcount, 10) || 1);
        const isElse = mutation.islastitemelse === 'true' || mutation.islastitemelse === true;
        return isElse ? itemCount : itemCount + 1;
    }
    let maxCondition = 1;
    for (const key of Object.keys(args)) {
        const match = /^ELSE_BRANCH_CONDITION_(\d+)$/.exec(key);
        if (match) maxCondition = Math.max(maxCondition, Number(match[1]));
    }
    return maxCondition + 1;
};

/**
 * Run an if / else-if / else block.
 * @param {object} args block arguments
 * @param {object} util block utility
 */
const controlIfPrimitive = (args, util) => {
    let branch = Cast.toBoolean(args.CONDITION) ? 1 : 0;
    if (!branch) {
        for (const key of Object.keys(args)) {
            const match = /^ELSE_BRANCH_CONDITION_(\d+)$/.exec(key);
            if (!match) continue;
            if (Cast.toBoolean(args[key])) {
                branch = Number(match[1]);
                break;
            }
        }
    }
    if (!branch) branch = ifFallbackBranch(args, util);
    util.startBranch(branch, false);
};

/**
 * Run a switch block.
 * @param {object} args block arguments
 * @param {object} util block utility
 */
const controlSwitchPrimitive = (args, util) => {
    let caseCount = 0;
    const maxK = {};
    for (const key of Object.keys(args)) {
        const match = /^CASE_(\d+)_(\d+)$/.exec(key);
        if (!match) continue;
        const index = Number(match[1]);
        const valueIndex = Number(match[2]);
        if (index > caseCount) caseCount = index;
        if (!maxK[index] || valueIndex > maxK[index]) maxK[index] = valueIndex;
    }
    const mutation = currentMutation(util);
    if (mutation) {
        caseCount = Math.max(caseCount, parseInt(mutation.casecount, 10) || 0);
    }
    for (let i = 1; i <= caseCount; i++) {
        for (let k = 1; k <= (maxK[i] || 0); k++) {
            const key = `CASE_${i}_${k}`;
            if (Cast.compare(args.SWITCH, args[key]) === 0) {
                util.startBranch(i, false);
                return;
            }
        }
    }
    util.startBranch(caseCount + 1, false);
};

/**
 * Patch scratch-blocks and the VM with the dynamic control blocks.
 * @param {object} SB the scratch-blocks module
 * @param {VirtualMachine} vm the scratch vm
 */
const patchDynamicControlBlocks = (SB, vm) => {
    if (patched) return;
    patched = true;
    ScratchBlocks = SB;
    vmRef = vm;

    defineButtonField();
    patchIfBlock(ScratchBlocks.Blocks.control_if);
    defineSwitchBlock();
    patchCompiler();

    const runtime = vm.runtime;
    runtime._primitives.control_if = controlIfPrimitive;
    runtime._primitives.control_switch = controlSwitchPrimitive;
};

export {
    patchDynamicControlBlocks
};
