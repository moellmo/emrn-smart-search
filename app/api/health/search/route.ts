import { typesenseSearch } from "../../../../lib/typesense";
import {
  createSearchHealthHandlers,
  searchHealthParameters,
} from "../../../../lib/search-health";
import { PRODUCT_COLLECTION_ALIAS } from "../../../../lib/search-index";

const handlers = createSearchHealthHandlers(() =>
  typesenseSearch
    .collections(PRODUCT_COLLECTION_ALIAS)
    .documents()
    .search(searchHealthParameters)
);

export async function GET() {
  return handlers.GET();
}

export async function HEAD() {
  return handlers.HEAD();
}
