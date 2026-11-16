import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { copyText } from "./lib/clipboard";
import { coverLetters } from "./lib/cover-letters";
import { formatSalary, number } from "./lib/hh";
import type { ProcessedResult } from "./lib/workspace";
import { getProcessed } from "./lib/workspace";
import "./PriorityView.css";
import "./RemoteView.css";
import VacancyActions from "./VacancyActions";
import VacancySource from "./VacancySource";

import "./Workspace.css";

export default function WorkspaceView({
  tab,
}: {
  tab: "processed" | "letters";
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState({ text: "", page: 0 });
  const [result, setResult] = useState<{
    key: string;
    data: ProcessedResult;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const key = JSON.stringify(query);
  const title =
    tab === "processed" ? "Обработанные вакансии" : "Сопроводительные";
  useEffect(() => {
    if (tab !== "processed") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await getProcessed(
          query.text,
          query.page,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setResult({ key, data });
          setError("");
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Не удалось загрузить обработанные вакансии.",
          );
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void refresh();
          }, 15_000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, query, key, revision]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 3000);
    return () => clearTimeout(timer);
  }, [copied]);
  const data = result?.key === key ? result.data : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setQuery({ text: search.trim(), page: 0 });
  };
  const restored = (id: string) => {
    setResult((current) =>
      current
        ? {
            ...current,
            data: {
              ...current.data,
              items: current.data.items.filter(
                (item) => item.vacancy.id !== id,
              ),
            },
          }
        : current,
    );
    setRevision((value) => value + 1);
  };
  async function copy(id: string, text: string) {
    setError("");
    try {
      await copyText(text);
      setCopied(id);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось скопировать письмо.",
      );
    }
  }
  return (
    <div className="app-shell remote-view priority-view workspace-view">
      <header className="site-header">
        <a className="brand" href="/">
          <span className="brand-mark">
            j<span>f</span>
          </span>
          jobfinder
          <span className="brand-divider" />
          <span className="brand-section">{title}</span>
        </a>
        <a className="source-link" href="/">
          Вся удалёнка ↗
        </a>
      </header>
      <nav className="view-navigation curated-navigation" aria-label="Разделы">
        <a href="/">Вся удалёнка</a>
        <a
          href="/?view=processed"
          aria-current={tab === "processed" ? "page" : undefined}
        >
          Обработанные
        </a>
        <a
          href="/?view=letters"
          aria-current={tab === "letters" ? "page" : undefined}
        >
          Сопроводительные
        </a>

      </nav>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">МОЙ ПОИСК РАБОТЫ</div>
            <h1>
              {title}
              <span>.</span>
            </h1>
            <p>
              {tab === "processed"
                ? "Вакансии с отметкой «Откликнулся». Они скрыты из обычной выдачи; отметку можно снять и вернуть вакансию."
                : "Сохранённые письма для быстрого отклика. Подходящий шаблон предлагается прямо у вакансии, текст можно выбрать и скопировать вручную."}
            </p>
          </div>
        </div>
        {error && (
          <section className="panel error-state" role="alert">
            <p>{error}</p>
            {tab === "processed" && (
              <button
                className="text-button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Повторить
              </button>
            )}
          </section>
        )}
        {tab === "letters" ? (
          <div className="letter-library">
            {coverLetters.map((letter) => (
              <article className="panel saved-letter" key={letter.id}>
                <div className="panel-heading">
                  <h2>{letter.name}</h2>
                  <span className="tag">{letter.categories.join(" · ")}</span>
                </div>
                <textarea
                  className="cover-letter-text"
                  aria-label={`Сопроводительное: ${letter.name}`}
                  readOnly
                  value={letter.text}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  className="copy-cover-letter"
                  onClick={() => {
                    void copy(letter.id, letter.text);
                  }}
                >
                  {copied === letter.id
                    ? "✓ Скопировано"
                    : "Скопировать сопроводительное"}
                </button>
                <span className="copy-feedback" role="status">
                  {copied === letter.id ? "Письмо в буфере обмена" : ""}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <>
            <section className="panel remote-controls">
              <form className="remote-search" onSubmit={submit}>
                <label>
                  <span>Поиск в обработанных вакансиях</span>
                  <input
                    type="search"
                    maxLength={200}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Должность, компания или навык"
                  />
                </label>
                <button type="submit">Найти</button>
              </form>
              {query.text && (
                <button
                  className="text-button"
                  onClick={() => {
                    setSearch("");
                    setQuery({ text: "", page: 0 });
                  }}
                >
                  Сбросить поиск
                </button>
              )}
            </section>
            {!data && !error && (
              <p className="priority-loading" role="status">
                Загружаем обработанные вакансии…
              </p>
            )}
            {data && (
              <section className="processed-results" aria-live="polite">
                <div className="priority-section-heading">
                  <h2>
                    {query.text ? "Найдено в обработанных" : "Обработано"}:{" "}
                    {number(data.filtered)}
                  </h2>
                  <p>
                    Сначала последние отклики · история сохраняется без
                    ограничения по дате публикации
                  </p>
                </div>
                {!data.items.length && (
                  <div className="panel priority-empty">
                    <h2>
                      {query.text
                        ? "Поиск не дал результатов"
                        : "Здесь появятся ваши отклики"}
                    </h2>
                    <p>
                      {query.text
                        ? "Попробуйте другое название или сбросьте поиск."
                        : "Нажмите «Откликнулся» у вакансии. Отметка сохраняется в JobFinder и переносит карточку сюда."}
                    </p>
                    <a href="/">Перейти к вакансиям ↗</a>
                  </div>
                )}
                <div className="priority-job-list">
                  {data.items.map(
                    ({ vacancy: job, processedAt, canRestore }) => (
                      <article
                        className="panel priority-job"
                        key={job.id}
                        data-job-id={job.id}
                      >
                        <div className="priority-job-heading">
                          <div>
                            <h3>
                              {job.alternate_url ? (
                                <a
                                  href={job.alternate_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {job.name} ↗
                                </a>
                              ) : (
                                job.name
                              )}
                            </h3>
                            <p>
                              {job.employer.name} · {job.area.name}
                            </p>
                          </div>
                          <strong>{formatSalary(job)}</strong>
                        </div>
                        <div className="priority-job-meta">
                          <span>{job.normalized_title?.name || job.name}</span>
                          <span>
                            {job.work_format
                              ?.map((item) => item.name)
                              .join(" / ")}
                          </span>
                        </div>
                        {!canRestore && (
                          <p className="saved-snapshot-note">
                            В общей базе вакансия больше недоступна. Здесь
                            сохранена её копия на момент отметки.
                          </p>
                        )}
                        <details className="vacancy-details">
                          <summary>Описание и навыки</summary>
                          <p className="description-text">{job.description}</p>
                          <div className="matched-skills">
                            {job.key_skills?.map((skill) => (
                              <span key={skill}>{skill}</span>
                            ))}
                          </div>
                        </details>
                        <VacancySource job={job} />
                        <VacancyActions
                          job={job}
                          processedAt={processedAt}
                          canRestore={canRestore}
                          onChanged={() => restored(job.id)}
                        />
                      </article>
                    ),
                  )}
                </div>
                {!!data.totalPages && (
                  <div className="remote-pagination">
                    <button
                      disabled={!data.page}
                      onClick={() =>
                        setQuery((current) => ({
                          ...current,
                          page: data.page - 1,
                        }))
                      }
                    >
                      ← Назад
                    </button>
                    <span>
                      Страница {data.page + 1} из {data.totalPages}
                    </span>
                    <button
                      disabled={data.page + 1 >= data.totalPages}
                      onClick={() =>
                        setQuery((current) => ({
                          ...current,
                          page: data.page + 1,
                        }))
                      }
                    >
                      Далее →
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
        <footer className="priority-footer">
          Личные отметки сохраняются на этом сервере. «Откликнулся» фиксирует
          ваш отклик в JobFinder.
        </footer>
      </main>
    </div>
  );
}
