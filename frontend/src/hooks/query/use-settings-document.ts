import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SettingsService, {
  SettingsDocumentPatch,
  SettingsDocumentReadScope,
  SettingsDocumentWriteScope,
} from "#/api/settings-service/settings-service.api";
import { useIsAuthed } from "./use-is-authed";

const DOCUMENT_QUERY_KEY = ["settings-document"];
const SCHEMA_QUERY_KEY = [...DOCUMENT_QUERY_KEY, "schema"];

export const useSettingsDocument = (
  scope: SettingsDocumentReadScope = "effective",
) => {
  const { data: isAuthenticated } = useIsAuthed();
  return useQuery({
    queryKey: [...DOCUMENT_QUERY_KEY, scope],
    queryFn: () => SettingsService.getSettingsDocument(scope),
    enabled: !!isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
    meta: { disableToast: true },
  });
};

export const useSettingsDocumentSchema = () => {
  const { data: isAuthenticated } = useIsAuthed();
  return useQuery({
    queryKey: SCHEMA_QUERY_KEY,
    queryFn: SettingsService.getSettingsDocumentSchema,
    enabled: !!isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: 1000,
    staleTime: 0,
    meta: { disableToast: true },
  });
};

export const usePatchSettingsDocument = (
  writeScope: SettingsDocumentWriteScope = "personal",
  readScope: SettingsDocumentReadScope = "effective",
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsDocumentPatch) =>
      SettingsService.patchSettingsDocument(patch, writeScope),
    onSuccess: (document) => {
      queryClient.setQueryData([...DOCUMENT_QUERY_KEY, readScope], document);
    },
  });
};
