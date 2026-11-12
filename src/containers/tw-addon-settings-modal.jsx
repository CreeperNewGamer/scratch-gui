import {connect} from 'react-redux';

import AddonSettingsModalComponent from '../components/tw-addon-settings-modal/addon-settings-modal.jsx';
import {closeAddonSettingsModal} from '../reducers/modals';

const mapStateToProps = state => ({
    initialSearch: state.scratchGui.modals.addonSettingsFocus
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeAddonSettingsModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(AddonSettingsModalComponent);
