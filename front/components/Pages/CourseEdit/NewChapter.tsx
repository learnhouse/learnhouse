import FormLayout, { Flex, FormField, Input, Textarea, FormLabel, ButtonBlack } from "@components/UI/Form/Form";
import { FormMessage } from "@radix-ui/react-form";
import * as Form from '@radix-ui/react-form';
import React, { useState } from "react";
import BarLoader from "react-spinners/BarLoader";

function NewChapterModal({ submitChapter, closeModal }: any) {
  const [chapterName, setChapterName] = useState("");
  const [chapterDescription, setChapterDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChapterNameChange = (e: any) => {
    setChapterName(e.target.value);
  };

  const handleChapterDescriptionChange = (e: any) => {
    setChapterDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ chapterName, chapterDescription });
    setIsSubmitting(true);
    await submitChapter({ name: chapterName, description: chapterDescription, activities: [] });
    setIsSubmitting(false);
  };

  return (

    <FormLayout onSubmit={handleSubmit}>
      <FormField name="chapter-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Chapter name</FormLabel>
          <FormMessage match="valueMissing">Please provide a chapter name</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleChapterNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="chapter-desc">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Chapter description</FormLabel>
          <FormMessage match="valueMissing">Please provide a chapter description</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleChapterDescriptionChange} required />
        </Form.Control>
      </FormField>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack type="submit" css={{ marginTop: 10 }}>
          {isSubmitting ? <BarLoader cssOverride={{borderRadius:60,}} width={60} color="#ffffff" />
             : "Create Chapter"}
            </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  );
}

export default NewChapterModal;
