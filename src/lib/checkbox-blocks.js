/**
 * Boolean block checkboxes, ported from PenguinMod.
 * Based on PenguinMod-Blocks' `core/field_checkbox_original.js` and
 * `blocks_common/checkbox.js` (Apache 2.0 / GPL-3.0).
 * https://github.com/PenguinMod/PenguinMod-Blocks
 */

import ArgumentType from 'scratch-vm/src/extension-support/argument-type';

const TRUE_COLOR = '#33D833';
const FALSE_COLOR = '#00000035';
const CHECKBOX_FIELD_NAME = 'CHECKBOX';

// Boolean inputs on vanilla Scratch blocks. Custom procedure call blocks are
// handled separately by inspecting their mutation.
const VANILLA_BOOLEAN_INPUTS = {
    control_if: ['CONDITION'],
    control_if_else: ['CONDITION'],
    control_repeat_until: ['CONDITION'],
    control_wait_until: ['CONDITION'],
    control_while: ['CONDITION'],
    operator_and: ['OPERAND1', 'OPERAND2'],
    operator_or: ['OPERAND1', 'OPERAND2'],
    operator_not: ['OPERAND']
};

let blocksPatched = false;
let scratchBlocks = null;

/**
 * Build the XML for a FALSE checkbox shadow.
 * @return {!Element} shadow XML element
 */
const createCheckboxShadowDom = () => {
    const shadow = document.createElement('shadow');
    shadow.setAttribute('type', 'checkbox');
    const field = document.createElement('field');
    field.setAttribute('name', CHECKBOX_FIELD_NAME);
    field.appendChild(document.createTextNode('FALSE'));
    shadow.appendChild(field);
    return shadow;
};

/**
 * Attach a checkbox shadow to every empty Boolean input in a workspace block
 * tree. Existing shadows and real reporter blocks are left alone.
 * @param {!Blockly.Block} rootBlock the block tree to inspect
 * @param {function} domToBlock scratch-blocks' original Xml.domToBlock
 */
const ensureWorkspaceCheckboxShadows = (rootBlock, domToBlock) => {
    if (!rootBlock || typeof rootBlock.getDescendants !== 'function') return;

    const descendants = rootBlock.getDescendants(false);
    for (const block of descendants) {
        if (block.isShadow && block.isShadow()) continue;
        for (const input of block.inputList) {
            const connection = input.connection;
            if (!connection || !connection.check_ ||
                connection.check_.indexOf('Boolean') === -1) {
                continue;
            }
            if (connection.targetBlock()) continue;

            let shadowDom = connection.getShadowDom();
            if (!shadowDom) {
                shadowDom = createCheckboxShadowDom();
                connection.setShadowDom(shadowDom);
            }

            const shadowBlock = domToBlock(shadowDom, block.workspace);
            if (shadowBlock.outputConnection) {
                connection.connect(shadowBlock.outputConnection);
            }
        }
    }
};

/**
 * Read the Boolean input names for a VM block.
 * @param {object} block the VM block
 * @return {Array<string>} Boolean input names
 */
const getVmBooleanInputs = block => {
    if (!block || !block.opcode) return [];

    const inputs = VANILLA_BOOLEAN_INPUTS[block.opcode];
    if (inputs) return inputs;

    if (block.opcode === 'procedures_call' && block.mutation) {
        const {proccode, argumentids} = block.mutation;
        if (typeof proccode !== 'string' || typeof argumentids !== 'string') {
            return [];
        }

        let ids;
        try {
            ids = JSON.parse(argumentids);
        } catch (e) {
            return [];
        }
        if (!Array.isArray(ids)) return [];

        const result = [];
        const components = proccode.split(/(?=[^\\]%[nbs])/);
        let argumentIndex = 0;
        for (const component of components) {
            if (component.charAt(0) !== '%') continue;
            const argumentType = component.charAt(1);
            if (argumentType === 'b' && ids[argumentIndex]) {
                result.push(ids[argumentIndex]);
            }
            argumentIndex++;
        }
        return result;
    }

    return [];
};

/**
 * Make sure the VM's current editing target has checkbox shadow blocks for
 * vanilla Boolean inputs. The workspace is generated from this data, so the
 * shadows need to exist in the VM for running, saving, and loading projects.
 * @param {VirtualMachine} vm the scratch vm
 * @return {boolean} whether any shadows were added
 */
const ensureVmCheckboxShadows = vm => {
    const target = vm.editingTarget;
    if (!target || !target.blocks || !target.blocks._blocks) return false;

    const blockContainer = target.blocks;
    const blocks = blockContainer._blocks;
    let changed = false;

    for (const id of Object.keys(blocks)) {
        const block = blocks[id];
        if (!block || block.shadow || !block.opcode) continue;

        const inputNames = getVmBooleanInputs(block);
        if (inputNames.length === 0) continue;

        if (!block.inputs) block.inputs = {};
        for (const name of inputNames) {
            let input = block.inputs[name];
            if (input && input.shadow && blocks[input.shadow]) continue;

            const shadowId = (scratchBlocks && scratchBlocks.utils) ?
                scratchBlocks.utils.genUid() :
                `checkboxShadow_${Date.now()}_${Math.random()}`;

            blocks[shadowId] = {
                id: shadowId,
                opcode: 'checkbox',
                inputs: {},
                fields: {
                    [CHECKBOX_FIELD_NAME]: {
                        name: CHECKBOX_FIELD_NAME,
                        value: 'FALSE'
                    }
                },
                next: null,
                topLevel: false,
                parent: block.id,
                shadow: true
            };

            if (!input) {
                input = {name: name, block: null, shadow: null};
                block.inputs[name] = input;
            }
            input.shadow = shadowId;
            changed = true;
        }
    }

    if (changed && typeof blockContainer.resetCache === 'function') {
        blockContainer.resetCache();
    }
    return changed;
};

const updateCheckColor = field => {
    const sourceBlock = field.sourceBlock_;
    if (!sourceBlock) return;

    if (field.state_ === 'TRUE') {
        sourceBlock.setShadowColour(TRUE_COLOR);
    } else if (sourceBlock.parentBlock_) {
        sourceBlock.shadowColour_ = FALSE_COLOR;
        sourceBlock.updateColour();
        if (sourceBlock.svgPath_) {
            sourceBlock.svgPath_.setAttribute('stroke', '#00000000');
        }
    }

    if (field.checkBackground_) {
        field.checkBackground_.setAttribute('fill',
            field.state_ === 'TRUE' ? TRUE_COLOR : sourceBlock.getColourTertiary());
    }
};

/**
 * Define the checkbox field and block in scratch-blocks.
 * @param {object} ScratchBlocks the scratch-blocks module
 */
const patchCheckboxBlocks = ScratchBlocks => {
    if (blocksPatched) return;
    blocksPatched = true;
    scratchBlocks = ScratchBlocks;

    const Field = ScratchBlocks.Field;

    const FieldCheckboxOriginal = function (state, optValidator) {
        FieldCheckboxOriginal.superClass_.constructor.call(this, '', optValidator);
        this.setValue(state);
        this.addArgType('checkbox');
    };
    ScratchBlocks.goog.inherits(FieldCheckboxOriginal, Field);

    FieldCheckboxOriginal.fromJson = options => new FieldCheckboxOriginal(
        options.checked ? 'TRUE' : 'FALSE'
    );

    FieldCheckboxOriginal.SYMBOL_FALSE =
        'M -2.5 -4.5 A 1 1 0 0 0 -4.5 -2.5 L -2 0 L -4.5 2.5 A 1 1 0 0 0 -2.5 4.5 ' +
        'L 0 2 L 2.5 4.5 A 1 1 0 0 0 4.5 2.5 L 2 0 L 4.5 -2.5 A 1 1 0 0 0 2.5 -4.5 ' +
        'L 0 -2 Z';
    FieldCheckboxOriginal.SYMBOL_TRUE =
        'M -4.5 1.5 A 1 1 90 0 1 -2.5 -0.5 L -1.5 0.5 L 2.5 -3.5 A 1 1 0 0 1 4.5 -1.5 ' +
        'L -0.5 3.5 Q -1.5 4.5 -2.5 3.5 Z';

    FieldCheckboxOriginal.prototype.CURSOR = 'pointer';

    FieldCheckboxOriginal.prototype.init = function () {
        if (this.fieldGroup_) {
            // Checkbox has already been initialized once.
            return;
        }
        FieldCheckboxOriginal.superClass_.init.call(this);
        if (this.sourceBlock_ && this.sourceBlock_.type !== 'checkbox') {
            this.checkBackground_ = ScratchBlocks.utils.createSvgElement(
                'path',
                {
                    d: 'M25.9 2.5H6.1A3.6 3.6 90 002.5 6.1v19.8A3.6 3.6 90 ' +
                        '006.1 29.5h19.8a3.6 3.6 90 003.6-3.6V6.1A3.6 3.6 90 0025.9 2.5'
                },
                this.fieldGroup_
            );
        }
        // The checkbox doesn't use the inherited text element.
        // Instead it uses a custom checkmark element that is either visible or not.
        this.checkElement_ = ScratchBlocks.utils.createSvgElement(
            'path',
            {
                class: 'blocklyText blocklyCheckbox',
                transform: `translate(${this.textElement_.getAttribute('x')},` +
                    `${this.textElement_.getAttribute('y') - 2}) scale(1.5)`
            },
            this.fieldGroup_
        );
        this.setValue(this.getValue());
        this.checkElement_.setAttribute(
            'd',
            this.state_ === 'TRUE' ?
                FieldCheckboxOriginal.SYMBOL_TRUE :
                FieldCheckboxOriginal.SYMBOL_FALSE
        );
        this.checkElement_.setAttribute('opacity', this.state_ === 'TRUE' ? 1 : 0.5);
        queueMicrotask(() => updateCheckColor(this));
    };

    FieldCheckboxOriginal.prototype.getValue = function () {
        return String(this.state_).toUpperCase();
    };

    FieldCheckboxOriginal.prototype.setValue = function (newBool) {
        const newState = (typeof newBool === 'string') ?
            (newBool.toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE') :
            String(Boolean(newBool)).toUpperCase();
        if (this.state_ !== newState) {
            if (this.sourceBlock_ && ScratchBlocks.Events.isEnabled()) {
                ScratchBlocks.Events.fire(new ScratchBlocks.Events.BlockChange(
                    this.sourceBlock_, 'field', this.name, this.state_, newState));
            }
            this.state_ = newState;
            if (this.checkElement_) {
                this.checkElement_.setAttribute(
                    'd',
                    this.state_ === 'TRUE' ?
                        FieldCheckboxOriginal.SYMBOL_TRUE :
                        FieldCheckboxOriginal.SYMBOL_FALSE
                );
                this.checkElement_.setAttribute('opacity', this.state_ === 'TRUE' ? 1 : 0.5);
            }
            if (this.sourceBlock_ && !this.sourceBlock_.isInsertionMarker()) {
                updateCheckColor(this);
            }
        }
    };

    FieldCheckboxOriginal.prototype.showEditor_ = function () {
        let newState = this.state_ === 'TRUE' ? 'FALSE' : 'TRUE';
        if (this.sourceBlock_) {
            // Call any validation function, and allow it to override.
            newState = this.callValidator(newState);
        }
        if (newState !== null) {
            this.setValue(String(newState).toUpperCase());
        }
    };

    FieldCheckboxOriginal.prototype.updateWidth = function () {
        FieldCheckboxOriginal.superClass_.updateWidth.call(this);
        this.size_.width = 8 * ScratchBlocks.BlockSvg.GRID_UNIT;
    };

    FieldCheckboxOriginal.prototype.getClickTarget_ = function () {
        const output = FieldCheckboxOriginal.superClass_.getClickTarget_.call(this);
        return this.sourceBlock_ && this.sourceBlock_.type !== 'checkbox' ?
            this.fieldGroup_ :
            output;
    };

    Field.register('field_checkbox_original', FieldCheckboxOriginal);

    const checkboxColors = ScratchBlocks.Colours.textField;
    ScratchBlocks.Blocks.checkbox = {
        init () {
            this.jsonInit({
                message0: '%1',
                args0: [
                    {
                        type: 'field_checkbox_original',
                        name: CHECKBOX_FIELD_NAME
                    }
                ],
                output: 'Boolean',
                outputShape: ScratchBlocks.OUTPUT_SHAPE_HEXAGONAL,
                colour: checkboxColors,
                colourSecondary: checkboxColors,
                colourTertiary: checkboxColors,
                colourQuaternary: checkboxColors
            });
        }
    };
};

/**
 * Make boolean extension arguments use a checkbox shadow by default.
 * @param {VirtualMachine} vm the scratch vm
 */
const patchBooleanArgumentShadows = vm => {
    const runtime = vm.runtime;
    if (runtime._twBooleanCheckboxPatched) return;
    runtime._twBooleanCheckboxPatched = true;

    const originalConvertPlaceholders = runtime._convertPlaceholders;
    runtime._convertPlaceholders = function (context, match, placeholder) {
        const result = originalConvertPlaceholders.call(this, context, match, placeholder);

        const argInfo = context.blockInfo.arguments[placeholder] || {};
        if (argInfo.type === ArgumentType.BOOLEAN && !argInfo.menu) {
            const inputList = context.inputList;
            const closeIndex = inputList.length - 1;
            if (closeIndex >= 0 && inputList[closeIndex] === '</value>') {
                const checked = argInfo.defaultValue === true ||
                    String(argInfo.defaultValue).toLowerCase() === 'true';
                inputList.splice(closeIndex, 0,
                    `<shadow type="checkbox"><field name="${CHECKBOX_FIELD_NAME}">` +
                    `${checked ? 'TRUE' : 'FALSE'}</field></shadow>`);
            }
        }

        return result;
    };
};

let workspacePatched = false;
/**
 * Add a checkbox shadow to every empty Boolean input as workspace blocks are
 * created. This covers toolbox/flyout blocks, duplicated blocks, and blocks
 * loaded from XML.
 * @param {object} ScratchBlocks the scratch-blocks module
 */
const patchWorkspaceCheckboxShadows = ScratchBlocks => {
    if (workspacePatched) return;
    workspacePatched = true;

    const originalDomToBlock = ScratchBlocks.Xml.domToBlock;
    ScratchBlocks.Xml.domToBlock = function (xmlBlock, workspace) {
        const block = originalDomToBlock.call(this, xmlBlock, workspace);
        ensureWorkspaceCheckboxShadows(block, originalDomToBlock);
        return block;
    };
};

/**
 * Make sure the VM includes checkbox shadows for vanilla Boolean inputs.
 * emitWorkspaceUpdate is used as the synchronization point because it is
 * called when projects, sprites, and editing targets are loaded.
 * @param {VirtualMachine} vm the scratch vm
 */
const patchVmCheckboxShadows = vm => {
    if (vm._twVanillaCheckboxPatched) return;
    vm._twVanillaCheckboxPatched = true;

    const originalEmitWorkspaceUpdate = vm.emitWorkspaceUpdate;
    vm.emitWorkspaceUpdate = function (...args) {
        ensureVmCheckboxShadows(this);
        return originalEmitWorkspaceUpdate.apply(this, args);
    };
};

export {
    patchCheckboxBlocks,
    patchBooleanArgumentShadows,
    patchWorkspaceCheckboxShadows,
    patchVmCheckboxShadows
};
