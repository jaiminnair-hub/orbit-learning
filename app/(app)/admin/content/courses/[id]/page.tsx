import { CourseEditor } from "./course-editor";

export default async function CourseAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CourseEditor courseId={id} />;
}
