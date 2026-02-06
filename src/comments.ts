import { Octokit } from '@octokit/action';
import { COMMENT_SIGNATURE } from './messages';

export type ReviewComment = {
  path: string;
  body: string;
  diff_hunk?: string;
  line?: number | null;
  in_reply_to_id?: number;
  id: number;
  start_line?: number | null;
  created_at?: string;
  user: {
    login: string;
  };
};

export type ReviewCommentThread = {
  file: string;
  comments: ReviewComment[];
};

export async function listPullRequestCommentThreads(
  octokit: Octokit,
  { owner, repo, pull_number }: { owner: string; repo: string; pull_number: number },
): Promise<ReviewCommentThread[]> {
  let { data: comments } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number,
  });

  comments = comments.map((c) => ({
    ...c,
    user: {
      ...c.user,
      login: isOwnComment(c.body) ? 'aireview' : c.user.login,
    },
  }));

  return generateCommentThreads(comments);
}

export async function getCommentThread(
  octokit: Octokit,
  {
    owner,
    repo,
    pull_number,
    comment_id,
  }: { owner: string; repo: string; pull_number: number; comment_id: number },
): Promise<ReviewCommentThread | null> {
  const threads = await listPullRequestCommentThreads(octokit, {
    owner,
    repo,
    pull_number,
  });
  return threads.find((t) => t.comments.some((c) => c.id === comment_id)) || null;
}

export function isThreadRelevant(thread: ReviewCommentThread): boolean {
  return thread.comments.some(
    (c) => c.body.includes(COMMENT_SIGNATURE) || c.body.includes('/aireview'),
  );
}

function generateCommentThreads(reviewComments: ReviewComment[]): ReviewCommentThread[] {
  const commentById = new Map<number, ReviewComment>();
  for (const comment of reviewComments) {
    commentById.set(comment.id, comment);
  }

  const findRootComment = (comment: ReviewComment): ReviewComment => {
    let current = comment;
    while (current.in_reply_to_id) {
      const parent = commentById.get(current.in_reply_to_id);
      if (!parent) {
        break;
      }
      current = parent;
    }
    return current;
  };

  const threadsByRootId = new Map<number, ReviewComment[]>();
  for (const comment of reviewComments) {
    if (!comment.body.length) {
      continue;
    }
    const root = findRootComment(comment);
    const rootId = root.id;
    const existing = threadsByRootId.get(rootId) ?? [];
    existing.push(comment);
    threadsByRootId.set(rootId, existing);
  }

  const sortByThreadOrder = (a: ReviewComment, b: ReviewComment) => {
    if (!a.in_reply_to_id && b.in_reply_to_id) {
      return -1;
    }
    if (a.in_reply_to_id && !b.in_reply_to_id) {
      return 1;
    }
    if (a.created_at && b.created_at) {
      return a.created_at.localeCompare(b.created_at);
    }
    return a.id - b.id;
  };

  return [...threadsByRootId.entries()].map(([rootId, comments]) => {
    const root = commentById.get(rootId) ?? comments[0];
    const sortedComments = [...comments].sort(sortByThreadOrder);
    return {
      file: root?.path ?? comments[0].path,
      comments: sortedComments,
    };
  });
}

export function isOwnComment(comment: string): boolean {
  return comment.includes(COMMENT_SIGNATURE);
}

export function buildComment(comment: string): string {
  return comment + '\n\n' + COMMENT_SIGNATURE;
}
