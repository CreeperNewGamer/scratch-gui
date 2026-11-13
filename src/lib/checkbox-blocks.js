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

let blocksPatched = false;

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

export {
    patchCheckboxBlocks,
    patchBooleanArgumentShadows
};
