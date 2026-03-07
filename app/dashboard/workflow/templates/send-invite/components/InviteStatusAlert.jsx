import { AlertCircle } from "lucide-react";

export default function InviteStatusAlert({ activationStatus, isProcessing }) {
  if (!activationStatus || isProcessing) {
    return null;
  }

  const tone =
    activationStatus.type === "success"
      ? "alert-success"
      : activationStatus.type === "warning"
        ? "alert-warning"
        : activationStatus.type === "info"
          ? "alert-info"
          : "alert-error";

  return (
    <div className={`absolute top-4 left-4 right-4 z-50 alert ${tone} shadow-xl`}>
      <AlertCircle className="h-4 w-4" />
      <div>
        <div className="font-medium">{activationStatus.message}</div>
        {activationStatus.details && (
          <div className="text-xs opacity-75">{activationStatus.details}</div>
        )}
      </div>
    </div>
  );
}

as