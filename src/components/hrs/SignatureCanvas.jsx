import { useRef, useEffect, useCallback } from "react";

export default function SignatureCanvas({ canvasRef, label, onSave }) {
  const drawing = useRef(false);

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * sx, y: (src.clientY - r.top) * sy };
  }, [canvasRef]);

  const saveSnapshot = useCallback(() => {
    if (onSave && canvasRef.current) {
      onSave(canvasRef.current.toDataURL('image/png'));
    }
  }, [onSave, canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const onDown = (e) => {
      drawing.current = true;
      ctx.beginPath();
      const p = getPos(e);
      ctx.moveTo(p.x, p.y);
    };
    const onMove = (e) => {
      if (!drawing.current) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "#3753a4";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    const onUp = () => {
      drawing.current = false;
      saveSnapshot();
    };

    const onTouchStart = (e) => { e.preventDefault(); onDown(e); };
    const onTouchMove = (e) => { e.preventDefault(); onMove(e); };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onUp);
    };
  }, [canvasRef, getPos, saveSnapshot]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      if (onSave) onSave(null);
    }
  };

  return (
    <div className="mb-7">
      <label className="text-[0.8rem] font-semibold text-hrs-blue2 tracking-[0.03em] uppercase mb-2.5 block">
        {label} <span className="text-hrs-orange">*</span>
      </label>
      <div className="border-2 border-dashed border-hrs-border rounded-lg bg-secondary overflow-hidden">
        <canvas
          ref={canvasRef}
          width={760}
          height={160}
          className="block w-full cursor-crosshair"
          style={{ height: "160px" }}
        />
      </div>
      <div className="flex gap-2.5 mt-2 items-center">
        <button
          type="button"
          onClick={clearCanvas}
          className="px-4 py-1.5 border-[1.5px] border-hrs-border rounded-md bg-card cursor-pointer text-[0.8rem] text-hrs-blue2 font-body transition-colors hover:border-hrs-red hover:text-hrs-red"
        >
          Clear
        </button>
        <span className="text-[0.75rem] text-hrs-muted">Draw your signature above</span>
      </div>
    </div>
  );
}