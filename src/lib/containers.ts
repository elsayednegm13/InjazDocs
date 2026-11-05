import { useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "@/app/i18n";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";

type ContainerRow = Record<string, string | number>;

type BookingWithContainers = { containers: ContainerRow[] } & Record<string, unknown>;

/**
 * Moves a container to its next stage with an optimistic cache update, so the row
 * changes the moment the operator clicks — the API call then confirms or rolls back.
 * Patches both the containers list and, when provided, the open booking detail.
 */
export function useContainerStatusMutation({ bookingId }: { bookingId?: string } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: string; version: string | number }) =>
      api(`/api/v1/containers/${input.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: input.status, version: Number(input.version) }),
      }),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["containers"] });
      if (bookingId) await client.cancelQueries({ queryKey: ["booking", bookingId] });
      const previousLists = client.getQueriesData<ContainerRow[]>({ queryKey: ["containers"] });
      const previousBooking = bookingId ? client.getQueryData<BookingWithContainers>(["booking", bookingId]) : undefined;
      const patch = (row: ContainerRow): ContainerRow =>
        row.id === input.id ? { ...row, status: input.status, version: Number(row.version) + 1 } : row;
      client.setQueriesData<ContainerRow[]>({ queryKey: ["containers"] }, (rows) => rows?.map(patch));
      if (bookingId) {
        client.setQueryData<BookingWithContainers>(["booking", bookingId], (data) =>
          data ? { ...data, containers: (data.containers ?? []).map(patch) } : data,
        );
      }
      return { previousLists, previousBooking };
    },
    onError: (error, _input, context) => {
      context?.previousLists.forEach(([key, data]) => client.setQueryData(key, data));
      if (bookingId && context?.previousBooking) client.setQueryData(["booking", bookingId], context.previousBooking);
      notifyError(error);
    },
    onSuccess: (_data, input) => {
      const key = `status.${input.status}`;
      const translated = i18n.t(key);
      notifySuccess(i18n.t("containerUpdated"), translated === key ? input.status : translated);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["containers"] });
      if (bookingId) void client.invalidateQueries({ queryKey: ["booking", bookingId] });
      void client.invalidateQueries({ queryKey: ["case"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
