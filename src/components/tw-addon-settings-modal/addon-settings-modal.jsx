import {defineMessages, injectIntl, intlShape} from 'react-intl';
import PropTypes from 'prop-types';
import React, {lazy, Suspense} from 'react';

import Modal from '../../containers/modal.jsx';
import LoadingSpinner from '../tw-loading-spinner/spinner.jsx';
import addonsIcon from '../menu-bar/addons.svg';
import downloadBlob from '../../lib/download-blob.js';
import styles from './addon-settings-modal.css';

const AddonSettings = lazy(() => import('../../addons/settings/settings.jsx'));

const messages = defineMessages({
    title: {
        defaultMessage: 'Addon Settings',
        description: 'Title of the addon settings dialog',
        id: 'tw.addonsSettings.title'
    }
});

const handleExportSettings = settings => {
    const blob = new Blob([JSON.stringify(settings)]);
    downloadBlob('turbowarp-addon-settings.json', blob);
};

const handleReload = () => {
    window.location.reload();
};

const AddonSettingsModalComponent = ({
    initialSearch,
    intl,
    onClose
}) => (
    <Modal
        className={styles.modalContent}
        contentLabel={intl.formatMessage(messages.title)}
        headerIcon={addonsIcon}
        id="addonSettingsModal"
        onRequestClose={onClose}
    >
        <div className={styles.body}>
            <Suspense fallback={<LoadingSpinner />}>
                <AddonSettings
                    embedded
                    initialSearch={initialSearch}
                    onExportSettings={handleExportSettings}
                    onReload={handleReload}
                />
            </Suspense>
        </div>
    </Modal>
);

AddonSettingsModalComponent.propTypes = {
    initialSearch: PropTypes.string,
    intl: intlShape.isRequired,
    onClose: PropTypes.func.isRequired
};

export default injectIntl(AddonSettingsModalComponent);
