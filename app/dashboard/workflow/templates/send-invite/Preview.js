"use client";

export default function EndorseSkillsPreview() {
  return (
    <div className="w-full h-full bg-gray-800 flex items-center justify-center">
      <div className="text-center">
        <div className="text-white text-sm font-medium mb-2">Send Invite</div>
        <div className="text-gray-400 text-xs">Simple connection invite workflow</div>
        <div className="mt-3 flex justify-center gap-2">
          <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
          <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
          <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
        </div>
      </div>
    </div>
  );
}
