// Guest web app: single column, centred and capped at 480 wide (UI spec 10.1).
// Side padding 20 on phones, 16 below 360 wide.
export default function GuestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 min-[360px]:px-5">
      {children}
    </div>
  );
}
