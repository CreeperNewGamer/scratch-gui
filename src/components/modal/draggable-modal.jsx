import PropTypes from 'prop-types';
import React from 'react';
import ReactModal from 'react-modal';

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [data-modal-no-drag]';
const KEEP_VISIBLE = 64;

/**
 * ReactModal wrapper that lets the user drag the dialog around the viewport.
 * Dialogs opt in by marking an element with the data-modal-drag-handle attribute.
 */
class DraggableModal extends React.Component {
    constructor (props) {
        super(props);
        this.content = null;
        this.dragState = null;
        this.activeHandle = null;
        this.offset = {x: 0, y: 0};
        this.handleContentRef = this.handleContentRef.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
    }

    componentWillUnmount () {
        this.playExitAnimation();
        this.detachDragListeners();
        if (this.content) {
            this.content.removeEventListener('pointerdown', this.handlePointerDown);
            this.content.style.transform = '';
        }
        this.content = null;
        this.activeHandle = null;
    }

    /**
     * Animate the dialog out after React unmounts it.
     *
     * React removes the modal portal synchronously, so there is no chance to
     * play a CSS transition. Instead, move the live content node out of the
     * portal before it is removed, keep it positioned exactly where it was,
     * and animate it with the Web Animations API. This catches every close
     * path (X button, Escape, OK/Cancel, back navigation, etc.) without
     * needing to change the individual dialogs.
     */
    playExitAnimation () {
        const content = this.content;
        if (!content || !content.isConnected || typeof content.animate !== 'function') return;
        if (
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
            return;
        }

        // Stop the entrance animation so it can't override the exit transform.
        content.style.animation = 'none';

        const rect = content.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const computed = window.getComputedStyle(content);

        // Detach from the portal so React's removal doesn't take it with it.
        document.body.appendChild(content);

        // Freeze the dialog in place and make it non-interactive.
        Object.assign(content.style, {
            position: 'fixed',
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: '0',
            transform: 'none',
            transformOrigin: 'center top',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            willChange: 'opacity, transform',
            zIndex: computed.zIndex === 'auto' ? '9999' : computed.zIndex,
            // Preserve inherited text styling from the modal overlay.
            color: computed.color
        });
        content.setAttribute('inert', '');
        content.setAttribute('aria-hidden', 'true');

        const animation = content.animate(
            [
                {opacity: 1, transform: 'translateY(0) scale(1)'},
                {opacity: 0, transform: 'translateY(8px) scale(0.96)'}
            ],
            {
                duration: 160,
                easing: 'cubic-bezier(0.4, 0, 1, 1)',
                fill: 'forwards'
            }
        );

        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            animation.onfinish = null;
            animation.oncancel = null;
            if (content.parentNode) {
                content.parentNode.removeChild(content);
            }
        };
        animation.onfinish = cleanup;
        animation.oncancel = cleanup;
        // Safety net in case the animation never finishes.
        setTimeout(cleanup, 500);
    }

    handleContentRef (content) {
        if (this.content) {
            this.content.removeEventListener('pointerdown', this.handlePointerDown);
        }
        if (content && content !== this.content) {
            this.offset = {x: 0, y: 0};
        }
        this.content = content;
        if (content) {
            content.addEventListener('pointerdown', this.handlePointerDown);
            if (this.props.draggable) {
                content.querySelectorAll('[data-modal-drag-handle]').forEach(handle => {
                    handle.style.cursor = 'grab';
                    // Let dragging work on touch screens without scrolling the page.
                    handle.style.touchAction = 'none';
                });
            }
        }
    }

    handlePointerDown (event) {
        if (!this.props.draggable || event.button !== 0) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const handle = target.closest('[data-modal-drag-handle]');
        if (!handle || !this.content || !this.content.contains(handle)) return;

        // Don't start dragging when interacting with a button, link, input, etc.
        if (target.closest(INTERACTIVE_SELECTOR)) return;

        const rect = this.content.getBoundingClientRect();
        this.dragState = {
            startX: event.clientX,
            startY: event.clientY,
            originX: this.offset.x,
            originY: this.offset.y,
            baseLeft: rect.left - this.offset.x,
            baseTop: rect.top - this.offset.y,
            width: rect.width,
            height: rect.height
        };
        this.activeHandle = handle;
        handle.style.cursor = 'grabbing';

        event.preventDefault();

        window.addEventListener('pointermove', this.handlePointerMove, {passive: false});
        window.addEventListener('pointerup', this.handlePointerUp);
        window.addEventListener('pointercancel', this.handlePointerUp);
    }

    handlePointerMove (event) {
        const state = this.dragState;
        if (!state || !this.content) return;

        const x = state.originX + (event.clientX - state.startX);
        const y = state.originY + (event.clientY - state.startY);

        // Keep a bit of the dialog on screen so it can always be grabbed again.
        const minX = KEEP_VISIBLE - state.baseLeft - state.width;
        const maxX = window.innerWidth - KEEP_VISIBLE - state.baseLeft;
        const minY = KEEP_VISIBLE - state.baseTop - state.height;
        const maxY = window.innerHeight - KEEP_VISIBLE - state.baseTop;

        this.offset = {
            x: Math.max(minX, Math.min(maxX, x)),
            y: Math.max(minY, Math.min(maxY, y))
        };
        this.content.style.transform = `translate(${this.offset.x}px, ${this.offset.y}px)`;

        event.preventDefault();
    }

    handlePointerUp () {
        this.detachDragListeners();
        this.dragState = null;
        if (this.activeHandle) {
            this.activeHandle.style.cursor = 'grab';
        }
        this.activeHandle = null;
    }

    detachDragListeners () {
        window.removeEventListener('pointermove', this.handlePointerMove);
        window.removeEventListener('pointerup', this.handlePointerUp);
        window.removeEventListener('pointercancel', this.handlePointerUp);
    }

    render () {
        const {
            draggable, // eslint-disable-line no-unused-vars
            ...modalProps
        } = this.props;
        return (
            <ReactModal
                ariaHideApp={false}
                bodyOpenClassName={null}
                shouldCloseOnOverlayClick={false}
                {...modalProps}
                contentRef={this.handleContentRef}
            />
        );
    }
}

DraggableModal.propTypes = {
    draggable: PropTypes.bool
};

DraggableModal.defaultProps = {
    draggable: true
};

export default DraggableModal;
