import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {FormattedMessage} from 'react-intl';
import {connect} from 'react-redux';

import check from './check.svg';
import dropdownCaret from './dropdown-caret.svg';
import {MenuItem, Submenu} from '../menu/menu.jsx';
import {Theme} from '../../lib/themes/index.js';
import {openCatBlocksMenu, catBlocksMenuOpen, closeSettingsMenu} from '../../reducers/menus.js';
import {setTheme} from '../../reducers/theme.js';
import {persistTheme} from '../../lib/themes/themePersistance.js';
import themeIcon from './tw-theme.svg';
import styles from './settings-menu.css';

const ThemeOption = ({isSelected, label, onClick}) => (
    <MenuItem onClick={onClick}>
        <div className={styles.option}>
            <img
                className={classNames(styles.check, {[styles.selected]: isSelected})}
                width={15}
                height={12}
                src={check}
                draggable={false}
            />
            {label}
        </div>
    </MenuItem>
);

ThemeOption.propTypes = {
    isSelected: PropTypes.bool,
    label: PropTypes.node,
    onClick: PropTypes.func
};

const CatBlocksThemeMenu = ({
    isOpen,
    isRtl,
    onChangeTheme,
    onOpenMenu,
    theme
}) => (
    <MenuItem expanded={isOpen}>
        <div
            className={styles.option}
            onClick={onOpenMenu}
        >
            <img
                className={styles.themeIcon}
                src={themeIcon}
                draggable={false}
                width={20}
                height={20}
            />
            <span className={styles.submenuLabel}>
                <FormattedMessage
                    defaultMessage="Theme"
                    description="Label for menu to choose the editor theme, such as cat blocks"
                    id="tw.menuBar.theme"
                />
            </span>
            <img
                className={styles.expandCaret}
                src={dropdownCaret}
                draggable={false}
            />
        </div>
        <Submenu place={isRtl ? 'left' : 'right'}>
            <ThemeOption
                isSelected={!theme.catBlocks}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => onChangeTheme(theme.set('catBlocks', false))}
                label={
                    <FormattedMessage
                        defaultMessage="Default"
                        description="Name of the default editor theme"
                        id="tw.theme.default"
                    />
                }
            />
            <ThemeOption
                isSelected={theme.catBlocks}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => onChangeTheme(theme.set('catBlocks', true))}
                label={
                    <FormattedMessage
                        defaultMessage="Cat Blocks"
                        description="Name of the cat blocks editor theme"
                        id="tw.theme.catBlocks"
                    />
                }
            />
        </Submenu>
    </MenuItem>
);

CatBlocksThemeMenu.propTypes = {
    isOpen: PropTypes.bool,
    isRtl: PropTypes.bool,
    onChangeTheme: PropTypes.func,
    onOpenMenu: PropTypes.func,
    theme: PropTypes.instanceOf(Theme)
};

const mapStateToProps = state => ({
    isOpen: catBlocksMenuOpen(state),
    isRtl: state.locales.isRtl,
    theme: state.scratchGui.theme.theme
});

const mapDispatchToProps = dispatch => ({
    onChangeTheme: theme => {
        dispatch(setTheme(theme));
        dispatch(closeSettingsMenu());
        persistTheme(theme);
    },
    onOpenMenu: () => dispatch(openCatBlocksMenu())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(CatBlocksThemeMenu);
