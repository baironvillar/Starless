import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type LibraryOrganisation,
  type PlaylistPreference,
  pinnedIds,
} from "./libraryOrganisationModel";
import {
  keys,
  libraryOrganisation,
  setPinnedOrder,
  setPlaylistPreference,
  useAccount,
} from "./spotify";

export type { LibraryOrganisation, PlaylistPreference } from "./libraryOrganisationModel";
export { organisedPlaylists, pinnedIds } from "./libraryOrganisationModel";

const EMPTY: LibraryOrganisation = {};
const DEFAULT: PlaylistPreference = { pinned: false, archived: false };

export function useLibraryOrganisation() {
  const accountQuery = useAccount();
  const account = accountQuery.data?.id ?? null;
  const client = useQueryClient();
  const key = keys.libraryOrganisation(account);
  const query = useQuery({
    queryKey: key,
    enabled: account !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<LibraryOrganisation> => {
      if (!account) return EMPTY;
      return libraryOrganisation(account);
    },
  });
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: `library-organisation:${account}` },
    mutationFn: async (
      change: { id: string; preference: PlaylistPreference } | { order: string[] },
    ) => {
      if (!account) throw new Error("no_session");
      const preferences =
        "order" in change
          ? await setPinnedOrder(account, change.order)
          : await setPlaylistPreference(account, change.id, change.preference);
      return { account, preferences };
    },
    onSuccess: ({ account, preferences }) => {
      // A save may finish after sign-out: never apply it to the new account.
      client.setQueryData<LibraryOrganisation>(keys.libraryOrganisation(account), preferences);
    },
  });
  return {
    preferences: query.data ?? EMPTY,
    ready: !!account && query.isSuccess,
    error: accountQuery.error ?? query.error ?? mutation.error,
    busy: useIsMutating({ mutationKey: key }) > 0,
    preference: (id: string) => query.data?.[id] ?? DEFAULT,
    change: mutation.mutate,
    move: async (id: string, target: string) => {
      const ids = pinnedIds(query.data ?? EMPTY);
      const from = ids.indexOf(id);
      const to = ids.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      ids.splice(from, 1);
      ids.splice(to, 0, id);
      await mutation.mutateAsync({ order: ids });
    },
  };
}
