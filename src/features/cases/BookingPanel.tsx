import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { Field, Select } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";

export function BookingPanel({ caseId, bookings }: { caseId: string; bookings: Array<Record<string, string | number>> }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const [bookingId, setBookingId] = useState("");
  const [linking, setLinking] = useState(false);
  const [open, setOpen] = useState(false);
  const live = bookings.filter((row) => String(row.status) !== "CANCELLED");
  const unlinked = useQuery({
    queryKey: ["bookings", "unlinked"],
    enabled: live.length === 0,
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/bookings?unlinked=1&pageSize=100`)).data,
  });
  return (
    <div className="space-y-4">
      {live.length === 0 ? (
        <FormDisclosure
          open={open}
          onToggle={() => setOpen((value) => !value)}
          title={tx("linkExistingBooking", "Link an existing booking")}
          hint={tx("bookingFirstHint", "Each export operation takes one sea booking. Create it first, then link it here.")}
          openLabel={tx("linkBooking", "Link booking")}
          closeLabel={tx("cancel", "Cancel")}
        >
        <form
        className="grid gap-3 md:grid-cols-[1fr_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!bookingId || linking) return;
          setLinking(true);
          try {
            await api(`/api/v1/bookings/${bookingId}/link`, {
              method: "POST",
              body: JSON.stringify({ caseId }),
            });
            setBookingId("");
            setOpen(false);
            notifySuccess(tx("bookingLinked", "Booking linked"));
            await client.invalidateQueries({ queryKey: ["case", caseId] });
            await client.invalidateQueries({ queryKey: ["bookings"] });
            await client.invalidateQueries({ queryKey: ["containers"] });
          } catch (error) {
            notifyError(error);
          } finally {
            setLinking(false);
          }
        }}
      >
        <Field label={tx("unlinkedBooking", "Booking waiting to be linked")}>
          <Select name="bookingId" value={bookingId} onChange={(event) => setBookingId(event.target.value)}>
            <option value="">{tx("select", "Select")}</option>
            {(unlinked.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.booking_number}{row.ucr ? ` · ${row.ucr}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={!bookingId || linking}>{tx("linkBooking", "Link booking")}</Button>
        </div>
      </form>
        </FormDisclosure>
      ) : <p className="text-xs leading-relaxed text-ink-muted">{tx("oneBookingHint", "This export operation already has its sea booking.")}</p>}
      {bookings.map((b) => (
        <Link key={String(b.id)} className="block rounded-card border border-line bg-card p-4 shadow-card" to={`/bookings/${b.id}`}>
          {String(b.booking_number)} · {String(b.status)} · {tx("expectedContainers", "Expected containers")} {String(b.expected_containers)}
        </Link>
      ))}
    </div>
  );
}
