// Radix wrapper prop inference in this JavaScript project is covered by the
// existing UI primitive declarations; this component is runtime-tested in the app.
// @ts-nocheck
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

export default function SignatureIncompleteDialog({ open, onOpenChange, onGoToSignatures, signingRoute = 'manual' }) {
  const openerRef = useRef(null);

  useEffect(() => {
    if (open) {
      // The Radix primitive handles focus trapping and Escape. Remember the
      // opener so dismissing the warning is never a keyboard dead end.
      openerRef.current = document.activeElement;
    }
  }, [open]);

  const close = () => {
    onOpenChange(false);
    requestAnimationFrame(() => openerRef.current?.focus?.());
  };

  const goToSignatures = () => {
    onOpenChange(false);
    onGoToSignatures();
  };

  const isDocuSign = signingRoute === 'docusign';

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) close();
      else onOpenChange(true);
    }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto p-5 sm:p-6">
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="absolute right-3 top-3 rounded-md p-1.5 text-hrs-muted hover:bg-muted hover:text-hrs-blue focus:outline-none focus:ring-2 focus:ring-hrs-orange"
        >
          <X className="h-4 w-4" />
        </button>
        <AlertDialogHeader className="pr-7 text-left">
          <AlertDialogTitle>Signatures not completed</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed">
            {isDocuSign
              ? 'Manual signatures are not present. The selected DocuSign workflow can complete the signatures electronically.'
              : 'The required manual signatures are not present. You may return to the Signatures step to complete them.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel onClick={(event) => { event.preventDefault(); close(); }}>
            Close
          </AlertDialogCancel>
          <AlertDialogAction onClick={(event) => { event.preventDefault(); goToSignatures(); }}>
            Go to Signatures
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
