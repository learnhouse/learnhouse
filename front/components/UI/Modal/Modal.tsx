import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { styled, keyframes } from '@stitches/react';
import { violet, blackA, mauve, green } from '@radix-ui/colors';

type ModalParams = {
    dialogTitle: string;
    dialogDescription: string;
    dialogContent: React.ReactNode;
    dialogClose?: React.ReactNode | null;
    dialogTrigger?: React.ReactNode;
    onOpenChange: any;
    isDialogOpen?: boolean;
    minHeight?: "sm" | "md" | "lg" | "xl"
};

const Modal = (params: ModalParams) => (
    <Dialog.Root open={params.isDialogOpen} onOpenChange={params.onOpenChange}>
        {params.dialogTrigger ? (
            <Dialog.Trigger asChild>
                {params.dialogTrigger}
            </Dialog.Trigger>
        ) : null}

        <Dialog.Portal>
            <DialogOverlay />
            <DialogContent minHeight={params.minHeight}>
                <DialogTopBar>
                    <DialogTitle>{params.dialogTitle}</DialogTitle>
                    <DialogDescription>
                        {params.dialogDescription}
                    </DialogDescription>
                </DialogTopBar>
                {params.dialogContent}
                {params.dialogClose ? (
                    <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
                        <Dialog.Close asChild>
                            {params.dialogClose}
                        </Dialog.Close>
                    </Flex>
                ) : null}
            </DialogContent>

        </Dialog.Portal>
    </Dialog.Root>
);

const overlayShow = keyframes({
    '0%': { opacity: 0 },
    '100%': { opacity: 1 },
});

const overlayClose = keyframes({
    '0%': { opacity: 1 },
    '100%': { opacity: 0 },
});

const contentShow = keyframes({
    '0%': { opacity: 0, transform: 'translate(-50%, -50%) scale(.96)' },
    '100%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
});

const contentClose = keyframes({
    '0%': { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    '100%': { opacity: 0, transform: 'translate(-50%, -52%) scale(.96)' },
});

const DialogOverlay = styled(Dialog.Overlay, {
    backgroundColor: blackA.blackA9,
    position: 'fixed',

    inset: 0,
    animation: `${overlayShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
    '&[data-state="closed"]': {
        animation: `${overlayClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
    },
});

const DialogContent = styled(Dialog.Content, {

    variants: {
        minHeight: {
            'sm': {
                minHeight: '300px',
            },
            'md': {
                minHeight: '500px',
            },
            'lg': {
                minHeight: '700px',
            },
            'xl': {
                minHeight: '900px',
            },
        },
    },

    backgroundColor: 'white',
    borderRadius: 18,
    boxShadow: 'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px',
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90vw',
    overflow: 'hidden',
    maxHeight: '85vh',
    minHeight: '300px',
    maxWidth: '600px',
    padding: 11,
    animation: `${contentShow} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
    '&:focus': { outline: 'none' },

    '&[data-state="closed"]': {
        animation: `${contentClose} 150ms cubic-bezier(0.16, 1, 0.3, 1)`,
    },
    transition: "max-height 0.3s ease-out",
});

const DialogTopBar = styled('div', {
    background: "#F7F7F7",
    padding: "8px 14px ",
    borderRadius: 14,
});
const DialogTitle = styled(Dialog.Title, {
    margin: 0,
    fontWeight: 700,
    letterSpacing: "-0.05em",
    padding: 0,
    color: mauve.mauve12,
    fontSize: 21,
});

const DialogDescription = styled(Dialog.Description, {
    color: mauve.mauve11,
    letterSpacing: "-0.03em",
    fontSize: 15,
    padding: 0,
    margin: 0,
});

const Flex = styled('div', { display: 'flex' });

const Button = styled('button', {
    all: 'unset',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    padding: '0 15px',
    fontSize: 15,
    lineHeight: 1,
    fontWeight: 500,
    height: 35,

    variants: {
        variant: {
            violet: {
                backgroundColor: 'white',
                color: violet.violet11,
                boxShadow: `0 2px 10px ${blackA.blackA7}`,
                '&:hover': { backgroundColor: mauve.mauve3 },
                '&:focus': { boxShadow: `0 0 0 2px black` },
            },
            green: {
                backgroundColor: green.green4,
                color: green.green11,
                '&:hover': { backgroundColor: green.green5 },
                '&:focus': { boxShadow: `0 0 0 2px ${green.green7}` },
            },
        },
    },

    defaultVariants: {
        variant: 'violet',
    },
});

const IconButton = styled('button', {
    all: 'unset',
    fontFamily: 'inherit',
    borderRadius: '100%',
    height: 25,
    width: 25,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: violet.violet11,
    position: 'absolute',
    top: 10,
    right: 10,

    '&:hover': { backgroundColor: violet.violet4 },
    '&:focus': { boxShadow: `0 0 0 2px ${violet.violet7}` },
});

const Fieldset = styled('fieldset', {
    all: 'unset',
    display: 'flex',
    gap: 20,
    alignItems: 'center',
    marginBottom: 15,
});

const Label = styled('label', {
    fontSize: 15,
    color: violet.violet11,
    width: 90,
    textAlign: 'right',
});

const Input = styled('input', {
    all: 'unset',
    width: '100%',
    flex: '1',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    padding: '0 10px',
    fontSize: 15,
    lineHeight: 1,
    color: violet.violet11,
    boxShadow: `0 0 0 1px ${violet.violet7}`,
    height: 35,

    '&:focus': { boxShadow: `0 0 0 2px ${violet.violet8}` },
});

export default Modal;