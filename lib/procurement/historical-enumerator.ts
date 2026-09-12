/**
 * OFFICIAL HISTORICAL DNCP PROCESS ENUMERATOR (2015-2026)
 *
 * Source: Official DNCP OpenAPI /search/processes interface
 * Filter semantics:
 *   - tipo_fecha: 'publicacion_llamado' (official publication timestamp)
 *   - fecha_desde / fecha_hasta: ISO dates (YYYY-MM-DD)
 *   - order: 'date asc' (deterministic timeline progression)
 *   - items_per_page: bounded page size (max 50)
 *
 * Designed for chunk/streaming traversal, checkpoint persistence and robust 429 backoff.
 */

export interface DateWindow {
  id: string; // e.g. "2015-H1"
  year: number;
  desde: string;
  hasta: string;
}

export interface EnumeratedProcessSummary {
  ocid: string;
  year: number;
  window_id: string;
  page: number;
  date_published?: string;
  title?: string;
  buyer_name?: string;
  category?: string;
}

export interface EnumeratorCheckpoint {
  current_window_idx: number;
  current_page: number;
  processed_ocids_count: number;
  last_ocid: string | null;
  last_updated_at: string;
  completed_windows: string[];
}

export class HistoricalDncpEnumerator {
  private baseUrl = "https://www.contrataciones.gov.py/datos/api/v3/doc";
  private minIntervalMs = 300;
  private lastCall = 0;
  private chain: Promise<unknown> = Promise.resolve();

  public readonly windows: DateWindow[] = [];

  constructor(startYear = 2015, endYear = 2026) {
    for (let y = startYear; y <= endYear; y++) {
      this.windows.push({
        id: `${y}-H1`,
        year: y,
        desde: `${y}-01-01`,
        hasta: `${y}-06-30`,
      });
      this.windows.push({
        id: `${y}-H2`,
        year: y,
        desde: `${y}-07-01`,
        hasta: `${y}-12-31`,
      });
    }
  }

  private async throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const wait = Math.max(0, this.lastCall + this.minIntervalMs - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  public async fetchSearchPage(
    window: DateWindow,
    page: number,
    itemsPerPage = 50,
    attempt = 0
  ): Promise<{
    records: any[];
    pagination: {
      total_items: number;
      total_pages: number;
      current_page: number;
      items_per_page: number;
      total_in_page: number;
    };
  }> {
    const params = new URLSearchParams({
      tipo_fecha: "publicacion_llamado",
      fecha_desde: window.desde,
      fecha_hasta: window.hasta,
      order: "date asc",
      page: String(page),
      items_per_page: String(itemsPerPage),
    });

    const url = `${this.baseUrl}/search/processes?${params.toString()}`;

    try {
      const res = await this.throttled(() =>
        fetch(url, { headers: { Accept: "application/json" } })
      );

      if (res.status === 429 && attempt < 6) {
        const backoffMs = 1500 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        return this.fetchSearchPage(window, page, itemsPerPage, attempt + 1);
      }

      if (!res.ok) {
        throw new Error(`HTTP_${res.status}: Failed to fetch search page ${page}`);
      }

      const json = await res.json();
      return {
        records: json.records || [],
        pagination: json.pagination || {
          total_items: 0,
          total_pages: 0,
          current_page: page,
          items_per_page: itemsPerPage,
          total_in_page: 0,
        },
      };
    } catch (err: any) {
      if (attempt < 4) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        return this.fetchSearchPage(window, page, itemsPerPage, attempt + 1);
      }
      throw err;
    }
  }

  public async *enumerateWindow(
    window: DateWindow,
    startPage = 1,
    onPageFetched?: (page: number, totalPages: number, itemsInPage: number) => void
  ): AsyncGenerator<EnumeratedProcessSummary, void, unknown> {
    let currentPage = startPage;
    let totalPages = 1;

    while (currentPage <= totalPages) {
      const { records, pagination } = await this.fetchSearchPage(window, currentPage);
      totalPages = pagination.total_pages || totalPages;

      if (onPageFetched) {
        onPageFetched(currentPage, totalPages, records.length);
      }

      for (const rec of records) {
        const cr = rec.compiledRelease || {};
        const tender = cr.tender || {};
        yield {
          ocid: rec.ocid || cr.ocid,
          year: window.year,
          window_id: window.id,
          page: currentPage,
          date_published: tender.datePublished || cr.date,
          title: tender.title,
          buyer_name: cr.buyer?.name || tender.procuringEntity?.name,
          category: tender.mainProcurementCategoryDetails || tender.mainProcurementCategory,
        };
      }

      currentPage++;
    }
  }
}