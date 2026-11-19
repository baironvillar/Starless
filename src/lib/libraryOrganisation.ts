import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  keys,
  libraryOrganisation,
  type Playlist,
  setPlaylistPreference,
  useAccount,
} from "./spotify";

export type PlaylistPreference = { pinned: boolean; archived: boolean };
export type LibraryOrganisation = Record<string, PlaylistPreference>;
const EMPTY: LibraryOrganisation = {};
const DEFAULT: PlaylistPreference = { pinned: false, archived: false };

/** Stable partition: the chosen library order still applies inside each group. */
export function organisedPlaylists(playlists: Playlist[], preferences: LibraryOrganisation) {
  const visible = playlists.filter((playlist) => !preferences[playlist.id]?.archived);
  return [
    ...visible.filter((playlist) => preferences[playlist.id]?.pinned),
    ...visible.filter((playlist) => !preferences[playlist.id]?.pinned),
  ];
}

export function useLibraryOrganisation() {
  const account = useAccount().data?.id ?? null;
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
    mutationFn: async ({ id, preference }: { id: string; preference: PlaylistPreference }) => {
      if (!account) throw new Error("no_session");
      await setPlaylistPreference(account, id, preference);
      return { account, id, preference };
    },
    onSuccess: ({ account, id, preference }) => {
      // A save may finish after sign-out: never apply it to the new account.
      client.setQueryData<LibraryOrganisation>(keys.libraryOrganisation(account), (old) => ({
        ...old,
        [id]: preference,
      }));
    },
  });
  return {
    preferences: query.data ?? EMPTY,
    ready: !!account && query.isSuccess,
    error: query.error ?? mutation.error,
    busy: mutation.isPending,
    preference: (id: string) => query.data?.[id] ?? DEFAULT,
    change: mutation.mutate,
  };
}
