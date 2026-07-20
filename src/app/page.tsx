import AvatarCallCard from "@/components/AvatarCallCard";

export const dynamic = "force-dynamic";

const DEFAULT_NAME = "Michael Shlomo Hamelleh";
const DEFAULT_ROLE = "Founder — CEO & Inventor";

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const name =
    firstValue(params.name)?.trim() ||
    (process.env.NEXT_PUBLIC_MEMBER_NAME ?? "").trim() ||
    DEFAULT_NAME;
  const role =
    firstValue(params.role)?.trim() ||
    (process.env.NEXT_PUBLIC_MEMBER_ROLE ?? "").trim() ||
    DEFAULT_ROLE;

  // The call starts automatically on load; pass ?autostart=0 to require a tap.
  const autostart = !["0", "false", "no"].includes(
    (firstValue(params.autostart) ?? "").toLowerCase(),
  );

  return (
    <main>
      <AvatarCallCard memberName={name} memberRole={role} autostart={autostart} />
    </main>
  );
}
